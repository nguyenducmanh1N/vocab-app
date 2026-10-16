from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clients.datamuse import SuggestClient
from app.clients.dictionary import DictionaryClient
from app.clients.email import EmailSender, LogEmailSender, SmtpEmailSender
from app.clients.gemini import AiClient, GeminiClient, MissingKeyClient
from app.core import security
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.db.session import SessionLocal, get_db
from app.models import User
from app.repositories import user_repository as user_repo

DbSession = Annotated[AsyncSession, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Cho việc chạy ở nền sau khi đã trả response, lúc session của request đã đóng."""
    return SessionLocal


SessionFactory = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """Giải access token và tải user; lỗi → 401 TOKEN_EXPIRED hoặc TOKEN_INVALID."""
    if credentials is None:
        raise security.token_invalid()
    user_id = security.decode_access_token(credentials.credentials)
    user = await user_repo.get_by_id(db, user_id)
    if user is None:
        raise security.token_invalid()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_ai_consent(user: CurrentUser, settings: AppSettings) -> None:
    """Gắn cho cả router /ai: chưa đồng ý, đã rút lại, hoặc đồng ý bản cũ → 403 (PLAN.md 9.16)."""
    if user.ai_consent_at is None or user.ai_consent_version != settings.ai_consent_version:
        raise AppError(
            403,
            "AI_CONSENT_REQUIRED",
            "Bạn cần đồng ý gửi dữ liệu cho AI trước khi dùng tính năng này",
        )


@lru_cache
def get_dictionary_client() -> DictionaryClient:
    """Một client (một connection pool) cho cả app; đóng khi app tắt (xem main.py)."""
    return DictionaryClient()


Dictionary = Annotated[DictionaryClient, Depends(get_dictionary_client)]


@lru_cache
def get_suggest_client() -> SuggestClient:
    return SuggestClient()


Suggester = Annotated[SuggestClient, Depends(get_suggest_client)]


@lru_cache
def get_ai_client() -> AiClient:
    """Test thay bằng bản giả qua app.dependency_overrides (PLAN.md 12.1)."""
    settings = get_settings()
    if not settings.gemini_api_key:
        return MissingKeyClient()
    return GeminiClient(
        settings.gemini_api_key, settings.gemini_model, settings.gemini_fallback_model
    )


Ai = Annotated[AiClient, Depends(get_ai_client)]


@lru_cache
def get_email_sender() -> EmailSender:
    """Test thay bằng bản giả ghi lại mail đã gửi (tests/conftest.py)."""
    settings = get_settings()
    if not settings.smtp_host:
        return LogEmailSender(show_body=settings.env == "development")
    return SmtpEmailSender(settings)


Mailer = Annotated[EmailSender, Depends(get_email_sender)]

__all__ = [
    "Ai",
    "AppSettings",
    "CurrentUser",
    "DbSession",
    "Dictionary",
    "Mailer",
    "SessionFactory",
    "Suggester",
    "get_ai_client",
    "get_current_user",
    "get_db",
    "get_dictionary_client",
    "get_email_sender",
    "get_session_factory",
    "get_settings",
    "get_suggest_client",
    "require_ai_consent",
]
