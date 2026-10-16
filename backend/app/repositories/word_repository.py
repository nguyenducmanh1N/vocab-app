import uuid
from collections.abc import Sequence

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.levels import Level, level_condition
from app.core.text import escape_like
from app.models import Word, WordList, WordProgress

LIKE_ESCAPE = "\\"


def with_progress(user_id: uuid.UUID) -> Select[tuple[Word, WordProgress]]:
    return (
        select(Word, WordProgress)
        .join(WordProgress, WordProgress.word_id == Word.id)
        .where(Word.user_id == user_id)
    )


def _matches(q: str) -> ColumnElement[bool]:
    """Khớp tiền tố của từ hoặc một phần nghĩa không dấu (PLAN.md 9.10). `q` đã viết thường."""
    pattern = escape_like(q)
    return func.lower(Word.term).like(pattern + "%", escape=LIKE_ESCAPE) | func.unaccent(
        func.lower(Word.meaning_vi)
    ).like("%" + func.unaccent(pattern) + "%", escape=LIKE_ESCAPE)


async def list_page(
    session: AsyncSession,
    user_id: uuid.UUID,
    list_id: uuid.UUID,
    *,
    level: Level | None,
    starred: bool | None,
    q: str | None,
    limit: int,
    offset: int,
) -> tuple[list[tuple[Word, WordProgress]], int]:
    query = with_progress(user_id).where(Word.list_id == list_id)
    if level is not None:
        query = query.where(level_condition(level))
    if starred is not None:
        query = query.where(Word.is_starred.is_(starred))
    if q:
        query = query.where(_matches(q.lower()))

    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = await session.execute(
        query.order_by(Word.created_at, Word.id).limit(limit).offset(offset)
    )
    return [(word, progress) for word, progress in rows], total or 0


async def get_many_with_progress(
    session: AsyncSession, user_id: uuid.UUID, word_ids: Sequence[uuid.UUID]
) -> list[tuple[Word, WordProgress]]:
    """Giữ thứ tự của word_ids; nạp lại giá trị phía server (updated_at…) sau khi ghi."""
    if not word_ids:
        return []
    rows = await session.execute(
        with_progress(user_id)
        .where(Word.id.in_(word_ids))
        .execution_options(populate_existing=True)
    )
    by_id = {word.id: (word, progress) for word, progress in rows}
    return [by_id[word_id] for word_id in word_ids if word_id in by_id]


async def get_with_progress(
    session: AsyncSession, user_id: uuid.UUID, word_id: uuid.UUID
) -> tuple[Word, WordProgress] | None:
    rows = await get_many_with_progress(session, user_id, [word_id])
    return rows[0] if rows else None


async def get(session: AsyncSession, user_id: uuid.UUID, word_id: uuid.UUID) -> Word | None:
    return await session.scalar(select(Word).where(Word.id == word_id, Word.user_id == user_id))


async def existing_terms_in_list(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, terms_lower: Sequence[str]
) -> dict[str, uuid.UUID]:
    """{lower(term): word_id} của các từ đã có trong list; một truy vấn cho cả lô."""
    if not terms_lower:
        return {}
    rows = await session.execute(
        select(func.lower(Word.term), Word.id).where(
            Word.user_id == user_id,
            Word.list_id == list_id,
            func.lower(Word.term).in_(terms_lower),
        )
    )
    return {term: word_id for term, word_id in rows}


async def find_in_list(
    session: AsyncSession,
    user_id: uuid.UUID,
    list_id: uuid.UUID,
    term_lower: str,
    exclude_word_id: uuid.UUID | None = None,
) -> uuid.UUID | None:
    query = select(Word.id).where(
        Word.user_id == user_id, Word.list_id == list_id, func.lower(Word.term) == term_lower
    )
    if exclude_word_id is not None:
        query = query.where(Word.id != exclude_word_id)
    return await session.scalar(query.limit(1))


async def find_in_other_lists(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, term_lower: str
) -> tuple[uuid.UUID, uuid.UUID, str] | None:
    """(word_id, list_id, list_name) của từ trùng ở list khác; lấy list tạo sớm nhất."""
    row = (
        await session.execute(
            select(Word.id, WordList.id, WordList.name)
            .join(WordList, WordList.id == Word.list_id)
            .where(
                Word.user_id == user_id,
                Word.list_id != list_id,
                func.lower(Word.term) == term_lower,
            )
            .order_by(WordList.created_at, Word.created_at)
            .limit(1)
        )
    ).first()
    return (row[0], row[1], row[2]) if row else None


async def all_in_list(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> list[Word]:
    """Mọi từ của list theo thứ tự hiển thị (created_at tăng dần), để nhân bản list."""
    rows = await session.scalars(
        select(Word)
        .where(Word.user_id == user_id, Word.list_id == list_id)
        .order_by(Word.created_at, Word.id)
    )
    return list(rows)


async def export_rows(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID | None = None
) -> list[tuple[str, Word, WordProgress]]:
    """(tên list, từ, tiến độ) để xuất CSV: theo tên list, rồi created_at (như danh sách từ)."""
    query = (
        with_progress(user_id)
        .add_columns(WordList.name)
        .join(WordList, WordList.id == Word.list_id)
    )
    if list_id is not None:
        query = query.where(Word.list_id == list_id)
    rows = await session.execute(
        query.order_by(func.lower(WordList.name), WordList.id, Word.created_at, Word.id)
    )
    return [(name, word, progress) for word, progress, name in rows]


async def add_with_progress(
    session: AsyncSession, user_id: uuid.UUID, words: Sequence[Word]
) -> None:
    """Thêm từ và dòng word_progress tương ứng trong cùng transaction (PLAN.md 7.2)."""
    session.add_all(words)
    await session.flush()
    session.add_all(WordProgress(word_id=word.id, user_id=user_id) for word in words)
    await session.flush()


async def search(
    session: AsyncSession, user_id: uuid.UUID, q: str, limit: int
) -> list[tuple[Word, WordProgress, str]]:
    """Câu SQL ở PLAN.md 9.10; `q` đã viết thường và cắt khoảng trắng."""
    rows = await session.execute(
        select(Word, WordProgress, WordList.name)
        .join(WordList, WordList.id == Word.list_id)
        .join(WordProgress, WordProgress.word_id == Word.id)
        .where(Word.user_id == user_id, _matches(q))
        .order_by((func.lower(Word.term) == q).desc(), Word.term)
        .limit(limit)
    )
    return [(word, progress, list_name) for word, progress, list_name in rows]


async def delete(session: AsyncSession, word: Word) -> None:
    # word_progress có ON DELETE CASCADE.
    await session.delete(word)
    await session.flush()


async def terms_with_prefix(
    session: AsyncSession, user_id: uuid.UUID, prefix_lower: str, limit: int
) -> list[str]:
    """Các term (viết thường, không trùng) của user bắt đầu bằng prefix; dùng cho gợi ý khi gõ."""
    term = func.lower(Word.term)
    rows = await session.scalars(
        select(term)
        .where(
            Word.user_id == user_id, term.like(escape_like(prefix_lower) + "%", escape=LIKE_ESCAPE)
        )
        .group_by(term)
        .order_by(term)
        .limit(limit)
    )
    return list(rows)
