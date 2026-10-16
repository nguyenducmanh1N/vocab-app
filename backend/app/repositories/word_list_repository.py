import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Row, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.levels import MASTERED_MIN_INTERVAL
from app.core.text import escape_like
from app.models import Word, WordList, WordProgress


@dataclass(frozen=True)
class ListStats:
    word_count: int
    mastered_count: int
    due_count: int


def _with_stats(user_id: uuid.UUID, now: datetime) -> Select[tuple[WordList, int, int, int]]:
    """Một truy vấn gộp: JOIN words + word_progress, GROUP BY list (PLAN.md 8.3)."""
    return (
        select(
            WordList,
            func.count(Word.id),
            func.count(WordProgress.word_id).filter(
                WordProgress.interval_days >= MASTERED_MIN_INTERVAL
            ),
            func.count(WordProgress.word_id).filter(WordProgress.due_at <= now),
        )
        .outerjoin(Word, (Word.list_id == WordList.id) & (Word.user_id == user_id))
        .outerjoin(WordProgress, WordProgress.word_id == Word.id)
        .where(WordList.user_id == user_id)
        .group_by(WordList.id)
    )


def _rows(
    result: Iterable[Row[tuple[WordList, int, int, int]]],
) -> list[tuple[WordList, ListStats]]:
    return [(wl, ListStats(words, mastered, due)) for wl, words, mastered, due in result]


async def list_with_stats(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    *,
    category_id: uuid.UUID | None = None,
    uncategorized: bool = False,
    q: str | None = None,
) -> list[tuple[WordList, ListStats]]:
    query = _with_stats(user_id, now)
    if category_id is not None:
        query = query.where(WordList.category_id == category_id)
    if uncategorized:
        query = query.where(WordList.category_id.is_(None))
    if q:
        # Không phân biệt hoa thường và dấu: "du lich" khớp "Du lịch".
        pattern = f"%{escape_like(q)}%"
        query = query.where(
            func.unaccent(func.lower(WordList.name)).like(
                func.unaccent(func.lower(pattern)), escape="\\"
            )
        )
    result = await session.execute(query.order_by(WordList.updated_at.desc(), WordList.id))
    return _rows(result)


async def get_with_stats(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID, now: datetime
) -> tuple[WordList, ListStats] | None:
    query = (
        _with_stats(user_id, now)
        .where(WordList.id == list_id)
        .execution_options(populate_existing=True)  # nạp lại updated_at sau khi sửa
    )
    rows = _rows(await session.execute(query))
    return rows[0] if rows else None


async def get(session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID) -> WordList | None:
    return await session.scalar(
        select(WordList).where(WordList.id == list_id, WordList.user_id == user_id)
    )


async def add(session: AsyncSession, word_list: WordList) -> WordList:
    session.add(word_list)
    await session.flush()
    return word_list


async def delete(session: AsyncSession, word_list: WordList) -> None:
    # words và word_progress có ON DELETE CASCADE.
    await session.delete(word_list)
    await session.flush()
