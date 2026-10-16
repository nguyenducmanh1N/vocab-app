"""List từ vựng (PLAN.md 8.3)."""

import uuid
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.time import now_utc
from app.models import Word, WordList
from app.repositories import category_repository, word_repository
from app.repositories import word_list_repository as repo
from app.repositories.word_list_repository import ListStats
from app.schemas.word_list import ListCreate, ListFilters, ListOut, ListUpdate

COPY_SUFFIX = " (bản sao)"
LIST_NAME_MAX = 100  # như ListName ở schemas/word_list.py


def copy_name(name: str) -> str:
    """ "Từ vựng (bản sao)"; cắt bớt tên gốc để tổng không quá 100 ký tự."""
    return name[: LIST_NAME_MAX - len(COPY_SUFFIX)].rstrip() + COPY_SUFFIX


def _not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "Không tìm thấy list")


def _to_out(word_list: WordList, stats: ListStats) -> ListOut:
    return ListOut(
        id=word_list.id,
        category_id=word_list.category_id,
        name=word_list.name,
        description=word_list.description,
        source=word_list.source,
        ai_topic=word_list.ai_topic,
        word_count=stats.word_count,
        mastered_count=stats.mastered_count,
        due_count=stats.due_count,
        created_at=word_list.created_at,
        updated_at=word_list.updated_at,
    )


async def _check_category(
    session: AsyncSession, user_id: uuid.UUID, category_id: uuid.UUID | None
) -> None:
    """Danh mục không có hoặc của người khác → 404 (PLAN.md 6.3)."""
    if (
        category_id is not None
        and await category_repository.get(session, user_id, category_id) is None
    ):
        raise AppError(404, "NOT_FOUND", "Không tìm thấy danh mục")


async def _get_out(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> ListOut:
    row = await repo.get_with_stats(session, user_id, list_id, now_utc())
    if row is None:
        raise _not_found()
    return _to_out(*row)


async def list_lists(
    session: AsyncSession, user_id: uuid.UUID, filters: ListFilters
) -> list[ListOut]:
    rows = await repo.list_with_stats(
        session,
        user_id,
        now_utc(),
        category_id=filters.category_id,
        uncategorized=filters.uncategorized,
        q=filters.q,
    )
    return [_to_out(word_list, stats) for word_list, stats in rows]


async def get(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> ListOut:
    return await _get_out(session, user_id, list_id)


async def create(session: AsyncSession, user_id: uuid.UUID, data: ListCreate) -> ListOut:
    await _check_category(session, user_id, data.category_id)
    word_list = await repo.add(session, WordList(user_id=user_id, **data.model_dump()))
    await session.commit()
    return await _get_out(session, user_id, word_list.id)


async def update(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, data: ListUpdate
) -> ListOut:
    word_list = await repo.get(session, user_id, list_id)
    if word_list is None:
        raise _not_found()
    changes = data.model_dump(exclude_unset=True)
    if changes.get("category_id") is not None:
        await _check_category(session, user_id, changes["category_id"])

    for field, value in changes.items():
        setattr(word_list, field, value)
    await session.commit()
    return await _get_out(session, user_id, list_id)


async def delete(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> None:
    word_list = await repo.get(session, user_id, list_id)
    if word_list is None:
        raise _not_found()
    await repo.delete(session, word_list)
    await session.commit()


async def duplicate(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> ListOut:
    """Nhân bản list và mọi từ (kể cả is_starred), không chép tiến độ (PLAN.md 8.3)."""
    original = await repo.get(session, user_id, list_id)
    if original is None:
        raise _not_found()
    copy = await repo.add(
        session,
        WordList(
            user_id=user_id,
            category_id=original.category_id,
            name=copy_name(original.name),
            description=original.description,
            source=original.source,
            ai_topic=original.ai_topic,
        ),
    )
    now = now_utc()
    words = [
        Word(
            user_id=user_id,
            list_id=copy.id,
            term=word.term,
            part_of_speech=word.part_of_speech,
            ipa=word.ipa,
            meaning_vi=word.meaning_vi,
            definition_en=word.definition_en,
            synonyms=list(word.synonyms),
            examples=[dict(example) for example in word.examples],
            audio_url=word.audio_url,
            note=word.note,
            is_starred=word.is_starred,
            # Cách nhau 1 µs để giữ đúng thứ tự cũ (danh sách từ sắp theo created_at).
            created_at=now + timedelta(microseconds=i),
        )
        for i, word in enumerate(await word_repository.all_in_list(session, user_id, list_id))
    ]
    await word_repository.add_with_progress(session, user_id, words)  # tiến độ mới: từ mới
    await session.commit()
    return await _get_out(session, user_id, copy.id)
