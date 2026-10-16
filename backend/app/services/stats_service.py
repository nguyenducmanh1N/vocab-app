"""Thống kê học tập (PLAN.md 8.3, 9.5): tổng quan, theo ngày, từ khó."""

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import local_today, start_of_local_day
from app.models import User
from app.repositories import stats_repository as repo
from app.repositories import study_repository
from app.schemas.stats import (
    DailyStat,
    HardWord,
    LevelCounts,
    ModeAccuracy,
    OverviewOut,
    TodayStats,
)
from app.schemas.user import UserSettings
from app.services.streak import STREAK_MIN_CARDS, STREAK_WINDOW_DAYS, compute_streaks

ACCURACY_DAYS = 30


async def overview(session: AsyncSession, user: User) -> OverviewOut:
    tz = user.timezone
    today = local_today(tz)
    goal = UserSettings.model_validate(user.settings).daily_goal_cards

    rows = await repo.daily_rows(session, user.id, today, today)
    cards_done = rows[0].cards_done if rows else 0
    active = await study_repository.active_days(
        session, user.id, today - timedelta(days=STREAK_WINDOW_DAYS - 1), STREAK_MIN_CARDS
    )
    streak_current, streak_best = compute_streaks(active, today)
    accuracy = await repo.accuracy_by_mode(
        session, user.id, start_of_local_day(today - timedelta(days=ACCURACY_DAYS - 1), tz)
    )

    return OverviewOut(
        streak_current=streak_current,
        streak_best=streak_best,
        today=TodayStats(
            cards_done=cards_done,
            goal=goal,
            goal_met=cards_done >= goal,
            new_words=rows[0].new_words if rows else 0,
            correct=rows[0].correct if rows else 0,
        ),
        levels=LevelCounts(**await repo.level_counts(session, user.id)),
        due_today=await repo.count_due_before(
            session, user.id, start_of_local_day(today + timedelta(days=1), tz)
        ),
        accuracy_30d=[
            ModeAccuracy(mode=mode, total=total, correct=correct)
            for mode, total, correct in accuracy
        ],
    )


async def daily(session: AsyncSession, user: User, days: int) -> list[DailyStat]:
    """Đủ `days` ngày tới hôm nay (giờ của user), tăng dần; ngày không học trả 0."""
    today = local_today(user.timezone)
    start = today - timedelta(days=days - 1)
    by_day = {
        row.activity_date: row for row in await repo.daily_rows(session, user.id, start, today)
    }
    result: list[DailyStat] = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        row = by_day.get(day)
        result.append(
            DailyStat(
                date=day,
                cards_done=row.cards_done if row else 0,
                correct=row.correct if row else 0,
                new_words=row.new_words if row else 0,
                study_seconds=row.study_seconds if row else 0,
            )
        )
    return result


async def hard_words(session: AsyncSession, user: User, limit: int) -> list[HardWord]:
    return [
        HardWord(
            word_id=word.id,
            term=word.term,
            meaning_vi=word.meaning_vi,
            wrong_count=progress.wrong_count,
            lapses=progress.lapses,
        )
        for word, progress in await repo.hard_words(session, user.id, limit)
    ]
