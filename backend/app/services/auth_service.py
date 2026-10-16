"""Đăng ký, đăng nhập, xoay vòng refresh token, đăng xuất (PLAN.md 9.1)."""

import uuid
from datetime import timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.time import now_utc
from app.models import RefreshToken, User
from app.repositories import refresh_token_repository as token_repo
from app.repositories import user_repository as user_repo
from app.schemas.auth import AuthOut, LoginIn, RegisterIn, TokenPair
from app.schemas.user import PasswordChange, UserOut

# Khi email không tồn tại vẫn verify với hash này để thời gian phản hồi như khi sai mật khẩu.
_DUMMY_HASH = security.hash_password("dummy-password-for-timing")


def _email_exists() -> AppError:
    return AppError(409, "EMAIL_EXISTS", "Email này đã được đăng ký")


def _invalid_credentials() -> AppError:
    return AppError(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng")


async def issue_tokens(
    session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID, device_name: str | None
) -> TokenPair:
    raw_refresh = security.new_refresh_token()
    await token_repo.add(
        session,
        RefreshToken(
            user_id=user_id,
            token_hash=security.hash_refresh_token(raw_refresh),
            family_id=family_id,
            device_name=device_name,
            expires_at=now_utc() + timedelta(days=get_settings().refresh_token_days),
        ),
    )
    access_token, expires_in = security.create_access_token(user_id)
    return TokenPair(access_token=access_token, refresh_token=raw_refresh, expires_in=expires_in)


async def register(session: AsyncSession, data: RegisterIn) -> AuthOut:
    if await user_repo.get_by_email(session, data.email) is not None:
        raise _email_exists()
    try:
        user = await user_repo.add(
            session,
            User(
                email=data.email,
                password_hash=security.hash_password(data.password),
                display_name=data.display_name,
            ),
        )
    except IntegrityError as exc:  # hai request đăng ký cùng email cùng lúc
        await session.rollback()
        raise _email_exists() from exc

    tokens = await issue_tokens(session, user.id, uuid.uuid4(), device_name=None)
    await session.commit()
    return AuthOut(user=UserOut.model_validate(user), tokens=tokens)


async def login(session: AsyncSession, data: LoginIn) -> AuthOut:
    user = await user_repo.get_by_email(session, data.email)
    if user is None:
        security.verify_password(data.password, _DUMMY_HASH)
        raise _invalid_credentials()

    ok, new_hash = security.verify_password(data.password, user.password_hash)
    if not ok:
        raise _invalid_credentials()
    if new_hash is not None:
        user.password_hash = new_hash

    tokens = await issue_tokens(session, user.id, uuid.uuid4(), data.device_name)  # family mới
    await session.commit()
    return AuthOut(user=UserOut.model_validate(user), tokens=tokens)


async def refresh(session: AsyncSession, raw_refresh: str) -> TokenPair:
    now = now_utc()
    token = await token_repo.get_by_hash_for_update(
        session, security.hash_refresh_token(raw_refresh)
    )
    if token is None:
        raise security.token_invalid()

    if token.revoked_at is not None:
        # Token đã thu hồi bị dùng lại: có thể đã bị lộ, thu hồi cả chuỗi.
        await token_repo.revoke_family(session, token.user_id, token.family_id, now)
        await session.commit()
        raise AppError(401, "REFRESH_REUSED", "Phiên đăng nhập đã bị thu hồi, hãy đăng nhập lại")

    if token.expires_at <= now:
        raise security.token_invalid()

    token.revoked_at = now
    tokens = await issue_tokens(session, token.user_id, token.family_id, token.device_name)
    await session.commit()
    return tokens


async def logout(session: AsyncSession, user: User, raw_refresh: str) -> None:
    await token_repo.revoke_by_hash(
        session, user.id, security.hash_refresh_token(raw_refresh), now_utc()
    )
    await session.commit()


async def change_password(session: AsyncSession, user: User, data: PasswordChange) -> TokenPair:
    """Đổi mật khẩu: thu hồi mọi refresh token của user rồi cấp family mới (PLAN.md 9.1)."""
    ok, _ = security.verify_password(data.current_password, user.password_hash)
    if not ok:
        raise AppError(401, "INVALID_CREDENTIALS", "Mật khẩu hiện tại không đúng")

    user.password_hash = security.hash_password(data.new_password)
    await token_repo.revoke_all_for_user(session, user.id, now_utc())
    tokens = await issue_tokens(session, user.id, uuid.uuid4(), device_name=None)
    await session.commit()
    return tokens
