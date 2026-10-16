"""Từ vựng: thêm, sửa, xoá, thêm hàng loạt, tìm kiếm (PLAN.md 8.3, 9.10)."""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.levels import level_of
from app.core.text import normalize_term
from app.models import Word, WordProgress
from app.repositories import word_list_repository as list_repo
from app.repositories import word_repository as repo
from app.schemas.common import Page
from app.schemas.word import (
    BulkCreate,
    BulkOut,
    ProgressOut,
    SearchParams,
    SkippedWord,
    WordCreate,
    WordFilters,
    WordOut,
    WordSearchOut,
    WordUpdate,
)

DUPLICATE_IN_LIST = "duplicate_in_list"


def _word_not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "Không tìm thấy từ")


def _list_not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "Không tìm thấy list")


def _duplicate(details: dict[str, Any], message: str = "Từ này đã có trong list") -> AppError:
    return AppError(409, "DUPLICATE_WORD", message, details)


def to_word_out(word: Word, progress: WordProgress) -> WordOut:
    return WordOut(
        id=word.id,
        list_id=word.list_id,
        term=word.term,
        part_of_speech=word.part_of_speech,
        ipa=word.ipa,
        meaning_vi=word.meaning_vi,
        definition_en=word.definition_en,
        synonyms=word.synonyms,
        examples=word.examples,  # dict -> Example
        audio_url=word.audio_url,
        note=word.note,
        is_starred=word.is_starred,
        progress=ProgressOut(
            level=level_of(progress.due_at, progress.interval_days),
            due_at=progress.due_at,
            interval_days=progress.interval_days,
            repetitions=progress.repetitions,
            lapses=progress.lapses,
            is_leech=progress.is_leech,
            correct_count=progress.correct_count,
            wrong_count=progress.wrong_count,
            last_reviewed_at=progress.last_reviewed_at,
        ),
        mnemonic=word.mnemonic,
        word_family=word.word_family,  # dict -> FamilyItem
        collocations=word.collocations,
        confusables=word.confusables,
        created_at=word.created_at,
        updated_at=word.updated_at,
    )


async def _load_out(
    session: AsyncSession, user_id: uuid.UUID, word_ids: Sequence[uuid.UUID]
) -> list[WordOut]:
    rows = await repo.get_many_with_progress(session, user_id, word_ids)
    return [to_word_out(word, progress) for word, progress in rows]


async def _require_list(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> None:
    if await list_repo.get(session, user_id, list_id) is None:
        raise _list_not_found()


def _new_word(user_id: uuid.UUID, list_id: uuid.UUID, data: WordCreate) -> Word:
    return Word(user_id=user_id, list_id=list_id, **data.model_dump(mode="json"))


async def _commit_or_duplicate(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:  # ux_words_list_term: hai request cùng từ cùng lúc
        await session.rollback()
        raise _duplicate({}) from exc


async def list_words(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, filters: WordFilters
) -> Page[WordOut]:
    await _require_list(session, user_id, list_id)
    rows, total = await repo.list_page(
        session,
        user_id,
        list_id,
        level=filters.level,
        starred=filters.starred,
        q=filters.q,
        limit=filters.limit,
        offset=filters.offset,
    )
    return Page(items=[to_word_out(word, progress) for word, progress in rows], total=total)


async def get(session: AsyncSession, user_id: uuid.UUID, word_id: uuid.UUID) -> WordOut:
    row = await repo.get_with_progress(session, user_id, word_id)
    if row is None:
        raise _word_not_found()
    return to_word_out(*row)


async def create(
    session: AsyncSession,
    user_id: uuid.UUID,
    list_id: uuid.UUID,
    data: WordCreate,
    *,
    allow_duplicate: bool,
) -> WordOut:
    await _require_list(session, user_id, list_id)
    term = normalize_term(data.term)

    # Trùng trong list: luôn 409, kể cả allow_duplicate=true.
    existing_id = await repo.find_in_list(session, user_id, list_id, term)
    if existing_id is not None:
        raise _duplicate({"existing_word_id": str(existing_id)})

    if not allow_duplicate:
        other = await repo.find_in_other_lists(session, user_id, list_id, term)
        if other is not None:
            word_id, other_list_id, other_list_name = other
            raise _duplicate(
                {
                    "existing_word_id": str(word_id),
                    "list_id": str(other_list_id),
                    "list_name": other_list_name,
                },
                message=f'Từ này đã có trong list "{other_list_name}"',
            )

    word = _new_word(user_id, list_id, data)
    try:
        await repo.add_with_progress(session, user_id, [word])
    except IntegrityError as exc:
        await session.rollback()
        raise _duplicate({}) from exc
    await _commit_or_duplicate(session)
    return (await _load_out(session, user_id, [word.id]))[0]


async def bulk_create(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, data: BulkCreate
) -> BulkOut:
    """Bỏ qua từ đã có trong list hoặc lặp lại trong lô; trùng ở list khác vẫn thêm."""
    await _require_list(session, user_id, list_id)
    terms = [normalize_term(item.term) for item in data.words]
    taken = set(await repo.existing_terms_in_list(session, user_id, list_id, terms))

    words: list[Word] = []
    skipped: list[SkippedWord] = []
    for item, term in zip(data.words, terms, strict=True):
        if term in taken:
            skipped.append(SkippedWord(term=item.term, reason=DUPLICATE_IN_LIST))
            continue
        taken.add(term)
        words.append(_new_word(user_id, list_id, item))

    if words:
        try:
            await repo.add_with_progress(session, user_id, words)
        except IntegrityError as exc:
            await session.rollback()
            raise _duplicate({}) from exc
        await _commit_or_duplicate(session)
    created = await _load_out(session, user_id, [word.id for word in words])
    return BulkOut(created=created, skipped=skipped)


async def update(
    session: AsyncSession, user_id: uuid.UUID, word_id: uuid.UUID, data: WordUpdate
) -> WordOut:
    word = await repo.get(session, user_id, word_id)
    if word is None:
        raise _word_not_found()
    changes = data.model_dump(mode="json", exclude_unset=True)
    if "list_id" in changes:
        changes["list_id"] = data.list_id

    target_list = changes.get("list_id", word.list_id)
    if target_list != word.list_id:
        await _require_list(session, user_id, target_list)
    if target_list != word.list_id or "term" in changes:
        term = normalize_term(changes.get("term", word.term))
        existing_id = await repo.find_in_list(
            session, user_id, target_list, term, exclude_word_id=word.id
        )
        if existing_id is not None:
            raise _duplicate({"existing_word_id": str(existing_id)})

    for field, value in changes.items():
        setattr(word, field, value)
    await _commit_or_duplicate(session)
    return (await _load_out(session, user_id, [word.id]))[0]


async def delete(session: AsyncSession, user_id: uuid.UUID, word_id: uuid.UUID) -> None:
    word = await repo.get(session, user_id, word_id)
    if word is None:
        raise _word_not_found()
    await repo.delete(session, word)
    await session.commit()


async def search(
    session: AsyncSession, user_id: uuid.UUID, params: SearchParams
) -> list[WordSearchOut]:
    q = params.q.strip().lower()
    rows = await repo.search(session, user_id, q, params.limit)
    return [
        WordSearchOut(**to_word_out(word, progress).model_dump(), list_name=list_name)
        for word, progress, list_name in rows
    ]
