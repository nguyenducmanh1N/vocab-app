"""Chọn thẻ (PLAN.md 9.3) và ghi nhận kết quả phiên học (9.4)."""

import uuid
from collections.abc import Collection
from datetime import date, datetime
from typing import Any

from sqlalchemy import Select, exists, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DailyActivity, ReviewLog, StudySession, Word, WordProgress
from app.repositories.word_repository import with_progress

Rows = list[tuple[Word, WordProgress]]


def _scope(
    user_id: uuid.UUID, list_id: uuid.UUID | None, starred_only: bool
) -> Select[tuple[Word, WordProgress]]:
    query = with_progress(user_id)
    if list_id is not None:
        query = query.where(Word.list_id == list_id)
    if starred_only:
        query = query.where(Word.is_starred.is_(True))
    return query


async def _fetch(session: AsyncSession, query: Select[tuple[Word, WordProgress]]) -> Rows:
    return [(word, progress) for word, progress in await session.execute(query)]


async def due_words(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    *,
    list_id: uuid.UUID | None,
    starred_only: bool,
    limit: int,
) -> Rows:
    """Đến hạn (due_at ≤ now), hạn sớm nhất trước."""
    if limit <= 0:
        return []
    query = (
        _scope(user_id, list_id, starred_only)
        .where(WordProgress.due_at <= now)
        .order_by(WordProgress.due_at, Word.id)
        .limit(limit)
    )
    return await _fetch(session, query)


async def new_words(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    list_id: uuid.UUID | None,
    starred_only: bool,
    limit: int,
) -> Rows:
    """Chưa học lần nào (due_at null), thêm trước học trước."""
    if limit <= 0:
        return []
    query = (
        _scope(user_id, list_id, starred_only)
        .where(WordProgress.due_at.is_(None))
        .order_by(Word.created_at, Word.id)
        .limit(limit)
    )
    return await _fetch(session, query)


async def other_words(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    *,
    list_id: uuid.UUID,
    starred_only: bool,
    limit: int,
) -> Rows:
    """Đã học, chưa đến hạn; lâu chưa ôn trước (last_reviewed_at null trước)."""
    if limit <= 0:
        return []
    query = (
        _scope(user_id, list_id, starred_only)
        .where(WordProgress.due_at > now)
        .order_by(WordProgress.last_reviewed_at.asc().nulls_first(), Word.id)
        .limit(limit)
    )
    return await _fetch(session, query)


async def count_due_and_new(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime,
    *,
    list_id: uuid.UUID | None,
    starred_only: bool,
) -> tuple[int, int]:
    subquery = _scope(user_id, list_id, starred_only).subquery()
    due_at = subquery.c.due_at
    row = (
        await session.execute(
            select(
                func.count().filter(due_at <= now),
                func.count().filter(due_at.is_(None)),
            ).select_from(subquery)
        )
    ).one()
    return row[0], row[1]


async def reviews_done(
    session: AsyncSession, user_id: uuid.UUID, start: datetime, end: datetime
) -> int:
    """Lượt ôn trong [start, end): đã cập nhật lịch và không phải lượt học từ mới."""
    count = await session.scalar(
        select(func.count()).where(
            ReviewLog.user_id == user_id,
            ReviewLog.counted_for_srs.is_(True),
            ReviewLog.interval_before > 0,
            ReviewLog.reviewed_at >= start,
            ReviewLog.reviewed_at < end,
        )
    )
    return count or 0


async def new_words_on(session: AsyncSession, user_id: uuid.UUID, day: date) -> int:
    count = await session.scalar(
        select(DailyActivity.new_words).where(
            DailyActivity.user_id == user_id, DailyActivity.activity_date == day
        )
    )
    return count or 0


async def distractors(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    prefer_list_ids: Collection[uuid.UUID],
    exclude_ids: Collection[uuid.UUID],
    exclude_terms: Collection[str],
    limit: int,
) -> list[Word]:
    """Từ khác ngoài cards: cùng list trước, thiếu thì lấy ngẫu nhiên trong kho."""
    base = select(Word).where(Word.user_id == user_id)
    if exclude_ids:
        base = base.where(Word.id.not_in(exclude_ids))
    if exclude_terms:
        base = base.where(func.lower(Word.term).not_in(exclude_terms))

    picked: list[Word] = []
    if prefer_list_ids:
        same_list = base.where(Word.list_id.in_(prefer_list_ids))
        picked += (await session.scalars(same_list.order_by(func.random()).limit(limit))).all()
        base = base.where(Word.list_id.not_in(prefer_list_ids))
    if len(picked) < limit:
        rest = base.order_by(func.random()).limit(limit - len(picked))
        picked += (await session.scalars(rest)).all()
    return picked


# --- Ghi nhận phiên học (9.4) ------------------------------------------------------------------


async def get_or_create_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    client_session_id: uuid.UUID,
    list_id: uuid.UUID | None,
    mode: str,
    started_at: datetime,
) -> StudySession:
    """Tạo phiên nếu chưa có (an toàn khi hai request cùng tạo), rồi khoá dòng để cộng số liệu."""
    await session.execute(
        insert(StudySession)
        .values(
            user_id=user_id,
            client_session_id=client_session_id,
            list_id=list_id,
            mode=mode,
            started_at=started_at,
        )
        .on_conflict_do_nothing(index_elements=[StudySession.client_session_id])
    )
    study = await session.scalar(
        select(StudySession)
        .where(StudySession.client_session_id == client_session_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert study is not None
    return study


async def has_other_log(
    session: AsyncSession,
    study_session_id: uuid.UUID,
    word_id: uuid.UUID,
    client_answer_id: uuid.UUID,
) -> bool:
    """Trong phiên đã có log khác của cùng từ → answer này không phải lần chấm đầu."""
    return bool(
        await session.scalar(
            select(
                exists().where(
                    ReviewLog.session_id == study_session_id,
                    ReviewLog.word_id == word_id,
                    ReviewLog.client_answer_id != client_answer_id,
                )
            )
        )
    )


async def insert_log(session: AsyncSession, values: dict[str, Any]) -> int | None:
    """None nghĩa là client_answer_id đã có (gửi lại)."""
    return await session.scalar(
        insert(ReviewLog)
        .values(**values)
        .on_conflict_do_nothing(index_elements=[ReviewLog.client_answer_id])
        .returning(ReviewLog.id)
    )


async def mark_log_counted(
    session: AsyncSession, log_id: int, interval_before: int, interval_after: int
) -> None:
    await session.execute(
        update(ReviewLog)
        .where(ReviewLog.id == log_id)
        .values(
            counted_for_srs=True, interval_before=interval_before, interval_after=interval_after
        )
    )


async def lock_progress(
    session: AsyncSession, user_id: uuid.UUID, word_id: uuid.UUID
) -> WordProgress | None:
    """Khoá lịch ôn của từ (FOR UPDATE); None nếu từ không thuộc user hoặc đã bị xoá."""
    return await session.scalar(
        select(WordProgress)
        .where(WordProgress.word_id == word_id, WordProgress.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def add_daily(
    session: AsyncSession,
    user_id: uuid.UUID,
    day: date,
    *,
    cards_done: int = 0,
    correct: int = 0,
    new_words: int = 0,
    study_seconds: int = 0,
) -> None:
    stmt = insert(DailyActivity).values(
        user_id=user_id,
        activity_date=day,
        cards_done=cards_done,
        correct=correct,
        new_words=new_words,
        study_seconds=study_seconds,
    )
    table = DailyActivity.__table__.c
    stmt = stmt.on_conflict_do_update(
        index_elements=[DailyActivity.user_id, DailyActivity.activity_date],
        set_={
            column: table[column] + stmt.excluded[column]
            for column in ("cards_done", "correct", "new_words", "study_seconds")
        },
    )
    await session.execute(stmt)


async def refresh_goal_met(
    session: AsyncSession, user_id: uuid.UUID, days: Collection[date], goal: int
) -> None:
    if not days:
        return
    await session.execute(
        update(DailyActivity)
        .where(DailyActivity.user_id == user_id, DailyActivity.activity_date.in_(days))
        .values(goal_met=DailyActivity.cards_done >= goal)
    )


async def cards_done_on(session: AsyncSession, user_id: uuid.UUID, day: date) -> int:
    count = await session.scalar(
        select(DailyActivity.cards_done).where(
            DailyActivity.user_id == user_id, DailyActivity.activity_date == day
        )
    )
    return count or 0


async def active_days(
    session: AsyncSession, user_id: uuid.UUID, since: date, min_cards: int
) -> list[date]:
    rows = await session.scalars(
        select(DailyActivity.activity_date).where(
            DailyActivity.user_id == user_id,
            DailyActivity.activity_date >= since,
            DailyActivity.cards_done >= min_cards,
        )
    )
    return list(rows)
