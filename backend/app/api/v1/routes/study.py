from typing import Annotated

from fastapi import APIRouter, Query

from app.api.v1.deps import CurrentUser, DbSession
from app.schemas.study import SessionIn, SessionOut, StudyQueueOut, StudyQueueParams
from app.services import study_service

router = APIRouter(prefix="/study", tags=["study"])


@router.get("/queue")
async def get_queue(
    params: Annotated[StudyQueueParams, Query()], db: DbSession, user: CurrentUser
) -> StudyQueueOut:
    """Không có list_id: Ôn tập hôm nay; có list_id: học theo list (PLAN.md 9.3)."""
    return await study_service.get_queue(db, user, params)


@router.post("/sessions")
async def record_session(data: SessionIn, db: DbSession, user: CurrentUser) -> SessionOut:
    """Idempotent theo client_session_id / client_answer_id: app gửi lại nhiều lần được (9.4)."""
    return await study_service.record_session(db, user, data)
