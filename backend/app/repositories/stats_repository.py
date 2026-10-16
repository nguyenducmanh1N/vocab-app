"""Truy vấn tổng hợp cho thống kê (PLAN.md 8.3)."""

import uuid
from datetime import date, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.levels import Level, level_condition
from app.models import DailyActivity, ReviewLog, Word, WordProgress

LEVELS: tuple[Level, ...] = ("new", "learning", "familiar", "mastered")


async def daily_rows(
    session: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> list[DailyActivity]:
    rows = await session.scalars(
        select(DailyActivity).where(
            DailyActivity.user_id == user_id,
            DailyActivity.activity_date >= start,
            DailyActivity.activity_date <= end,
        )
    )
    return list(rows)


async def level_counts(session: AsyncSession, user_id: uuid.UUID) -> dict[Level, int]:
    """Một truy vấn đếm 4 mức thuộc (7.4), cùng điều kiện với bộ lọc ?level=."""
    row = (
        await session.execute(
            select(*(func.count().filter(level_condition(level)) for level in LEVELS)).where(
                WordProgress.user_id == user_id
            )
        )
    ).one()
    return dict(zip(LEVELS, row, strict=True))


async def count_due_before(session: AsyncSession, user_id: uuid.UUID, before: datetime) -> int:
    count = await session.scalar(
        select(func.count()).where(
            WordProgress.user_id == user_id,
            WordProgress.due_at.is_not(None),
            WordProgress.due_at < before,
        )
    )
    return count or 0


async def accuracy_by_mode(
    session: AsyncSession, user_id: uuid.UUID, since: datetime
) -> list[tuple[str, int, int]]:
    """(mode, total, correct) chỉ tính lần chấm đầu của mỗi từ trong phiên."""
    rows = await session.execute(
        select(
            ReviewLog.mode,
            func.count(),
            func.count().filter(ReviewLog.is_correct.is_(True)),
        )
        .where(
            ReviewLog.user_id == user_id,
            ReviewLog.is_first_attempt.is_(True),
            ReviewLog.reviewed_at >= since,
        )
        .group_by(ReviewLog.mode)
        .order_by(ReviewLog.mode)
    )
    return [(mode, total, correct) for mode, total, correct in rows]


async def hard_words(
    session: AsyncSession, user_id: uuid.UUID, limit: int
) -> list[tuple[Word, WordProgress]]:
    """Từ hay quên: quên lại nhiều (lapses) trước, rồi trả lời sai nhiều."""
    rows = await session.execute(
        select(Word, WordProgress)
        .join(WordProgress, WordProgress.word_id == Word.id)
        .where(
            Word.user_id == user_id,
            or_(WordProgress.lapses > 0, WordProgress.wrong_count > 0),
        )
        .order_by(WordProgress.lapses.desc(), WordProgress.wrong_count.desc(), Word.term, Word.id)
        .limit(limit)
    )
    return [(word, progress) for word, progress in rows]
