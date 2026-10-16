from typing import Annotated

from fastapi import APIRouter, Query

from app.api.v1.deps import CurrentUser, DbSession
from app.schemas.notification import WordFeedOut, WordFeedParams
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/word-feed")
async def word_feed(
    params: Annotated[WordFeedParams, Query()], db: DbSession, user: CurrentUser
) -> WordFeedOut:
    """Từ cho thông báo đẩy từ vựng của `days` ngày tới, `per_day` từ mỗi ngày (9.9)."""
    return await notification_service.word_feed(db, user, params.days, params.per_day)
