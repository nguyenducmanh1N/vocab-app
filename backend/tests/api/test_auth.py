import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.config import get_settings
from app.models import RefreshToken, User
from tests.conftest import FakeClock

PASSWORD = "matkhau-dung-123"


async def register(
    client: AsyncClient, email: str = "an@example.com", password: str = PASSWORD
) -> Response:
    return await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": "An"},
    )


async def login(
    client: AsyncClient, email: str = "an@example.com", password: str = PASSWORD
) -> Response:
    return await client.post("/api/v1/auth/login", json={"email": email, "password": password})


async def refresh(client: AsyncClient, token: str) -> Response:
    return await client.post("/api/v1/auth/refresh", json={"refresh_token": token})


async def logout(client: AsyncClient, access: str, token: str) -> Response:
    return await client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": token},
        headers={"Authorization": f"Bearer {access}"},
    )


def error_code(response: Response) -> str:
    return response.json()["error"]["code"]


async def tokens_of(client: AsyncClient) -> dict[str, Any]:
    response = await register(client)
    assert response.status_code == 201, response.text
    return response.json()["tokens"]


# --- Đăng ký ---------------------------------------------------------------------------------


async def test_register_returns_user_and_tokens(client: AsyncClient, test_engine: AsyncEngine):
    response = await register(client, email="  An@Example.COM ")

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == "an@example.com"
    assert body["user"]["level"] == "B1"
    assert body["user"]["settings"]["daily_goal_cards"] == 20
    assert body["user"]["settings"]["notify"]["reminder_time"] == "20:00"
    assert "password_hash" not in body["user"]
    tokens = body["tokens"]
    assert tokens["token_type"] == "bearer"
    assert tokens["expires_in"] == 15 * 60

    # DB chỉ lưu SHA-256 của refresh token
    async with AsyncSession(test_engine) as session:
        stored = await session.scalar(select(RefreshToken.token_hash))
        user = await session.scalar(select(User))
    assert stored == hashlib.sha256(tokens["refresh_token"].encode()).hexdigest()
    assert user is not None and user.password_hash != PASSWORD


async def test_register_duplicate_email_is_409(client: AsyncClient):
    assert (await register(client, email="an@example.com")).status_code == 201

    response = await register(client, email="AN@example.com")

    assert response.status_code == 409
    assert error_code(response) == "EMAIL_EXISTS"


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "khong-phai-email", "password": PASSWORD, "display_name": "An"},
        {"email": "an@example.com", "password": "ngan", "display_name": "An"},
        {"email": "an@example.com", "password": PASSWORD, "display_name": "  "},
    ],
)
async def test_register_validation_error(client: AsyncClient, payload: dict[str, str]):
    response = await client.post("/api/v1/auth/register", json=payload)

    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


# --- Đăng nhập -------------------------------------------------------------------------------


async def test_login_success_case_insensitive_email(client: AsyncClient):
    await register(client)

    response = await login(client, email="AN@EXAMPLE.com")

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "an@example.com"
    assert response.json()["tokens"]["refresh_token"]


async def test_login_wrong_password_is_401(client: AsyncClient):
    await register(client)

    response = await login(client, password="sai-mat-khau")

    assert response.status_code == 401
    assert error_code(response) == "INVALID_CREDENTIALS"


async def test_login_unknown_email_is_401(client: AsyncClient):
    response = await login(client, email="khong-co@example.com")

    assert response.status_code == 401
    assert error_code(response) == "INVALID_CREDENTIALS"


async def test_sixth_login_in_a_minute_is_429(client: AsyncClient):
    await register(client)
    for _ in range(5):
        assert (await login(client)).status_code == 200

    response = await login(client)

    assert response.status_code == 429
    assert error_code(response) == "RATE_LIMITED"


# --- Refresh ---------------------------------------------------------------------------------


async def test_refresh_rotates_and_old_token_cannot_be_reused(client: AsyncClient):
    tokens = await tokens_of(client)

    response = await refresh(client, tokens["refresh_token"])

    assert response.status_code == 200
    new_tokens = response.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]
    assert new_tokens["access_token"]

    reused = await refresh(client, tokens["refresh_token"])
    assert reused.status_code == 401
    assert error_code(reused) == "REFRESH_REUSED"


async def test_reused_refresh_revokes_whole_family(client: AsyncClient, test_engine: AsyncEngine):
    tokens = await tokens_of(client)
    other_session = (await login(client)).json()["tokens"]  # family khác (thiết bị khác)
    rotated = (await refresh(client, tokens["refresh_token"])).json()

    reused = await refresh(client, tokens["refresh_token"])
    assert error_code(reused) == "REFRESH_REUSED"

    # Token mới nhất cùng family cũng bị thu hồi
    latest = await refresh(client, rotated["refresh_token"])
    assert latest.status_code == 401
    assert error_code(latest) == "REFRESH_REUSED"

    async with AsyncSession(test_engine) as session:
        active = await session.scalar(
            select(func.count()).select_from(RefreshToken).where(RefreshToken.revoked_at.is_(None))
        )
    assert active == 1  # chỉ còn token của family khác

    # Family khác không bị ảnh hưởng
    assert (await refresh(client, other_session["refresh_token"])).status_code == 200


async def test_refresh_unknown_token_is_invalid(client: AsyncClient):
    response = await refresh(client, "khong-ton-tai")

    assert response.status_code == 401
    assert error_code(response) == "TOKEN_INVALID"


async def test_refresh_expired_token_is_invalid(client: AsyncClient, clock: FakeClock):
    tokens = await tokens_of(client)
    clock.advance(days=31)

    response = await refresh(client, tokens["refresh_token"])

    assert response.status_code == 401
    assert error_code(response) == "TOKEN_INVALID"


# --- Access token và đăng xuất --------------------------------------------------------------


async def test_expired_access_token_is_token_expired(client: AsyncClient, clock: FakeClock):
    tokens = await tokens_of(client)
    clock.advance(minutes=16)

    response = await logout(client, tokens["access_token"], tokens["refresh_token"])

    assert response.status_code == 401
    assert error_code(response) == "TOKEN_EXPIRED"


async def test_access_token_still_valid_before_expiry(client: AsyncClient, clock: FakeClock):
    tokens = await tokens_of(client)
    clock.advance(minutes=14)

    response = await logout(client, tokens["access_token"], tokens["refresh_token"])

    assert response.status_code == 204


def _token(payload: dict[str, Any], secret: str | None = None) -> str:
    return jwt.encode(payload, secret or get_settings().jwt_secret, algorithm="HS256")


@pytest.mark.parametrize("kind", ["missing", "garbage", "wrong_type", "wrong_secret"])
async def test_bad_access_token_is_token_invalid(client: AsyncClient, kind: str):
    tokens = await tokens_of(client)
    access = jwt.decode(tokens["access_token"], options={"verify_signature": False})
    now = datetime.now(UTC)
    claims = {
        **access,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=5)).timestamp()),
    }
    headers = {
        "missing": {},
        "garbage": {"Authorization": "Bearer abc.def.ghi"},
        "wrong_type": {"Authorization": f"Bearer {_token({**claims, 'type': 'refresh'})}"},
        "wrong_secret": {"Authorization": f"Bearer {_token(claims, secret='x' * 32)}"},
    }[kind]

    response = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]}, headers=headers
    )

    assert response.status_code == 401
    assert error_code(response) == "TOKEN_INVALID"


async def test_logout_revokes_refresh_token(client: AsyncClient):
    tokens = await tokens_of(client)

    response = await logout(client, tokens["access_token"], tokens["refresh_token"])

    assert response.status_code == 204
    after = await refresh(client, tokens["refresh_token"])
    assert after.status_code == 401
    assert error_code(after) == "REFRESH_REUSED"
