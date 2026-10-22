import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps import Ai, CurrentUser, DbSession, Dictionary, require_ai_consent
from app.schemas.ai import (
    EnrichIn,
    EnrichOut,
    ExtractIn,
    HistoryItem,
    InsightsIn,
    InsightsOut,
    QuotaOut,
    SpeakingFeedbackIn,
    SpeakingFeedbackOut,
    SuggestIn,
    SuggestOut,
)
from app.services import ai_service

# Mọi route /ai/* (kể cả route thêm sau) cần user đã đồng ý dùng AI (PLAN.md 9.16).
router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(require_ai_consent)])


@router.post("/enrich")
async def enrich(
    data: EnrichIn, db: DbSession, user: CurrentUser, ai: Ai, dictionary: Dictionary
) -> EnrichOut:
    """Tự điền: một request tính một lượt (AI_ENRICH_DAILY_LIMIT mỗi ngày)."""
    return await ai_service.enrich(db, user, data, ai, dictionary)


@router.post("/suggest")
async def suggest(
    data: SuggestIn, db: DbSession, user: CurrentUser, ai: Ai, dictionary: Dictionary
) -> SuggestOut:
    """Gợi ý từ theo chủ đề; cùng tham số trong 7 ngày trả từ cache (không tính lượt)."""
    return await ai_service.suggest(db, user, data, ai, dictionary)


@router.get("/history")
async def history(
    db: DbSession, user: CurrentUser, limit: Annotated[int, Query(ge=1, le=50)] = 20
) -> list[HistoryItem]:
    """Các lượt gợi ý thành công của user, mới nhất trước; không gồm dòng lấy từ cache."""
    return await ai_service.history(db, user, limit)


@router.get("/history/{generation_id}")
async def history_detail(generation_id: uuid.UUID, db: DbSession, user: CurrentUser) -> SuggestOut:
    return await ai_service.history_detail(db, user, generation_id)


@router.get("/quota")
async def quota(db: DbSession, user: CurrentUser) -> QuotaOut:
    """Số lượt gợi ý, tự điền và nhận xét luyện nói còn lại hôm nay (không tốn lượt)."""
    return await ai_service.quota(db, user)


@router.post("/extract")
async def extract(
    data: ExtractIn, db: DbSession, user: CurrentUser, ai: Ai, dictionary: Dictionary
) -> SuggestOut:
    """Lọc từ đáng học trong ảnh (trang sách, biển hiệu…); tính 1 lượt gợi ý."""
    return await ai_service.extract(db, user, data, ai, dictionary)


@router.post("/insights")
async def insights(data: InsightsIn, db: DbSession, user: CurrentUser, ai: Ai) -> InsightsOut:
    """Họ từ, cụm đi kèm, mẹo nhớ, từ hay nhầm; lưu thẳng vào words, một request một lượt (9.12)."""
    return await ai_service.insights(db, user, data, ai)


@router.post("/speaking-feedback")
async def speaking_feedback(
    data: SpeakingFeedbackIn, db: DbSession, user: CurrentUser, ai: Ai
) -> SpeakingFeedbackOut:
    """Gemini nghe bản ghi luyện nói và nhận xét (9.11); bản ghi không được lưu trên server."""
    return await ai_service.speaking_feedback(db, user, data, ai)
