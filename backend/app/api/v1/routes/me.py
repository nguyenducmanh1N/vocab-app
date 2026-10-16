from fastapi import APIRouter, Request, Response, status

from app.api.v1.deps import AppSettings, CurrentUser, DbSession
from app.core.rate_limit import limiter
from app.schemas.auth import TokenPair
from app.schemas.user import (
    AccountDelete,
    AiConsentIn,
    AiConsentOut,
    PasswordChange,
    UserOut,
    UserUpdate,
)
from app.services import auth_service, export_service, user_service

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
async def get_me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("")
async def update_me(data: UserUpdate, db: DbSession, user: CurrentUser) -> UserOut:
    return UserOut.model_validate(await user_service.update_me(db, user, data))


@router.post("/ai-consent")
async def set_ai_consent(
    data: AiConsentIn, db: DbSession, user: CurrentUser, settings: AppSettings
) -> AiConsentOut:
    """Đồng ý hoặc rút lại đồng ý gửi nội dung cho Google Gemini (PLAN.md 9.16)."""
    user = await user_service.set_ai_consent(db, user, data.accepted, settings.ai_consent_version)
    return AiConsentOut.model_validate(user)


@router.post("/password")
async def change_password(data: PasswordChange, db: DbSession, user: CurrentUser) -> TokenPair:
    return await auth_service.change_password(db, user, data)


@router.get("/export")
async def export_all(db: DbSession, user: CurrentUser) -> Response:
    """Mọi từ của user dạng CSV (UTF-8 có BOM), theo tên list."""
    content, disposition = await export_service.export_all(db, user)
    return Response(
        content, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": disposition}
    )


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("5/minute")
async def delete_account(
    request: Request, data: AccountDelete, db: DbSession, user: CurrentUser
) -> Response:
    """Xác nhận mật khẩu rồi xoá tài khoản cùng mọi dữ liệu (không khôi phục được)."""
    await user_service.delete_account(db, user, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
