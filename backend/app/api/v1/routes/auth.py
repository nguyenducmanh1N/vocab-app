from fastapi import APIRouter, BackgroundTasks, Request, Response, status

from app.api.v1.deps import CurrentUser, DbSession, Mailer, SessionFactory
from app.core.rate_limit import limiter
from app.schemas.auth import (
    AuthOut,
    ForgotPasswordIn,
    LoginIn,
    LogoutIn,
    RefreshIn,
    RegisterIn,
    ResetPasswordIn,
    TokenPair,
)
from app.services import auth_service, password_reset_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(data: RegisterIn, db: DbSession) -> AuthOut:
    return await auth_service.register(db, data)


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, data: LoginIn, db: DbSession) -> AuthOut:
    return await auth_service.login(db, data)


@router.post("/refresh")
async def refresh(data: RefreshIn, db: DbSession) -> TokenPair:
    return await auth_service.refresh(db, data.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(data: LogoutIn, db: DbSession, user: CurrentUser) -> Response:
    await auth_service.logout(db, user, data.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/forgot", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/minute;10/hour")
async def forgot_password(
    request: Request,
    data: ForgotPasswordIn,
    sessions: SessionFactory,
    mailer: Mailer,
    background: BackgroundTasks,
) -> Response:
    """Luôn 204 ngay; tra DB, tạo mã và gửi mail đều chạy ở nền để thời gian phản hồi không lộ
    email có tồn tại hay không."""
    background.add_task(password_reset_service.request_code_and_send, sessions, mailer, data.email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/reset")
@limiter.limit("10/minute")
async def reset_password(request: Request, data: ResetPasswordIn, db: DbSession) -> AuthOut:
    return await password_reset_service.reset_password(db, data)
