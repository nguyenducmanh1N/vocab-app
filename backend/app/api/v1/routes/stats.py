from typing import Annotated

from fastapi import APIRouter, Query

from app.api.v1.deps import CurrentUser, DbSession
from app.schemas.stats import DailyParams, DailyStat, HardWord, HardWordsParams, OverviewOut
from app.services import stats_service

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview")
async def overview(db: DbSession, user: CurrentUser) -> OverviewOut:
    """Streak, hôm nay, mức thuộc, số từ cần ôn hôm nay, độ chính xác 30 ngày."""
    return await stats_service.overview(db, user)


@router.get("/daily")
async def daily(
    params: Annotated[DailyParams, Query()], db: DbSession, user: CurrentUser
) -> list[DailyStat]:
    """Theo ngày local của user, đủ `days` ngày; ngày không học trả 0."""
    return await stats_service.daily(db, user, params.days)


@router.get("/hard-words")
async def hard_words(
    params: Annotated[HardWordsParams, Query()], db: DbSession, user: CurrentUser
) -> list[HardWord]:
    return await stats_service.hard_words(db, user, params.limit)
