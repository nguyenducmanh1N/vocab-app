"""Quên mật khẩu qua mã OTP email (PLAN.md 8.3, 9.1)."""

import re
from datetime import timedelta
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core import security
from app.core.rate_limit import limiter
from app.models import PasswordResetCode
from tests.conftest import TEST_PASSWORD, FakeClock, SentEmail

FORGOT = "/api/v1/auth/password/forgot"
RESET = "/api/v1/auth/password/reset"
EMAIL = "an@example.com"  # email của fixture `auth`
NEW_PASSWORD = "matkhau-moi-456"


async def forgot(client: AsyncClient, email: str = EMAIL) -> Response:
    return await client.post(FORGOT, json={"email": email})


async def reset(
    client: AsyncClient, code: str, email: str = EMAIL, new_password: str = NEW_PASSWORD
) -> Response:
    return await client.post(
        RESET, json={"email": email, "code": code, "new_password": new_password}
    )


async def login(client: AsyncClient, password: str) -> Response:
    return await client.post("/api/v1/auth/login", json={"email": EMAIL, "password": password})


def code_in(mail: SentEmail) -> str:
    match = re.search(r"\b(\d{6})\b", mail.body)
    assert match, mail.body
    return match.group(1)


def other_code(code: str) -> str:
    return f"{(int(code) + 1) % 10**6:06d}"


async def request_code(client: AsyncClient, outbox: list[SentEmail]) -> str:
    sent = len(outbox)
    response = await forgot(client)
    assert response.status_code == 204, response.text
    assert len(outbox) == sent + 1
    return code_in(outbox[-1])


def error_code(response: Response) -> str:
    return response.json()["error"]["code"]


async def codes_of(test_engine: AsyncEngine) -> list[PasswordResetCode]:
    async with AsyncSession(test_engine) as session:
        rows = await session.scalars(
            select(PasswordResetCode).order_by(PasswordResetCode.created_at)
        )
        return list(rows)


# --- Xin mã ---


async def test_forgot_sends_six_digit_code_and_stores_only_hmac(
    client: AsyncClient,
    auth: dict[str, Any],
    outbox: list[SentEmail],
    test_engine: AsyncEngine,
    clock: FakeClock,
) -> None:
    response = await forgot(client)

    assert response.status_code == 204
    assert response.content == b""
    assert len(outbox) == 1
    assert outbox[0].to == EMAIL
    code = code_in(outbox[0])
    assert "10 phút" in outbox[0].body

    [row] = await codes_of(test_engine)
    assert row.code_hash != code
    assert len(row.code_hash) == 64
    assert row.code_hash == security.hash_reset_code(row.user_id, code)
    assert row.attempts == 0
    assert row.used_at is None
    assert row.created_at == clock.current
    assert row.expires_at == clock.current + timedelta(minutes=10)


async def test_forgot_unknown_email_looks_the_same_and_sends_nothing(
    client: AsyncClient, auth: dict[str, Any], outbox: list[SentEmail], test_engine: AsyncEngine
) -> None:
    known = await forgot(client)
    unknown = await forgot(client, "khongco@example.com")

    assert unknown.status_code == known.status_code == 204
    assert unknown.content == known.content
    assert dict(unknown.headers) == dict(known.headers)
    assert len(outbox) == 1  # chỉ mail cho email có thật
    assert len(await codes_of(test_engine)) == 1


async def test_forgot_email_is_case_insensitive(
    client: AsyncClient, auth: dict[str, Any], outbox: list[SentEmail]
) -> None:
    response = await forgot(client, "  An@Example.COM ")

    assert response.status_code == 204
    assert [mail.to for mail in outbox] == [EMAIL]


async def test_forgot_invalid_email_is_422(client: AsyncClient) -> None:
    response = await forgot(client, "khong-phai-email")

    assert response.status_code == 422
    assert error_code(response) == "VALIDATION_ERROR"


async def test_forgot_within_cooldown_sends_nothing_then_new_code_replaces_old(
    client: AsyncClient,
    auth: dict[str, Any],
    outbox: list[SentEmail],
    clock: FakeClock,
    test_engine: AsyncEngine,
) -> None:
    await request_code(client, outbox)

    clock.advance(seconds=59)
    again = await forgot(client)
    assert again.status_code == 204  # giới hạn theo tài khoản không trả 429 (lộ email)
    assert len(outbox) == 1

    clock.advance(seconds=2)
    second = await request_code(client, outbox)

    old_row, new_row = await codes_of(test_engine)
    assert old_row.used_at is not None  # mã cũ bị vô hiệu khi có mã mới
    assert new_row.used_at is None
    assert (await reset(client, second)).status_code == 200


async def test_forgot_at_most_five_codes_per_hour(
    client: AsyncClient,
    auth: dict[str, Any],
    outbox: list[SentEmail],
    clock: FakeClock,
) -> None:
    for _ in range(5):
        await request_code(client, outbox)
        clock.advance(minutes=2)
        limiter.reset()  # giới hạn theo IP tính giờ thật; ở đây chỉ thử giới hạn theo tài khoản

    sixth = await forgot(client)
    assert sixth.status_code == 204
    assert len(outbox) == 5

    clock.advance(minutes=51)  # mã đầu tiên đã cũ hơn 1 giờ
    await request_code(client, outbox)


async def test_forgot_is_rate_limited_per_ip(client: AsyncClient, outbox: list[SentEmail]) -> None:
    for i in range(3):
        response = await forgot(client, f"nguoi{i}@example.com")
        assert response.status_code == 204

    response = await forgot(client, "nguoi9@example.com")
    assert response.status_code == 429
    assert error_code(response) == "RATE_LIMITED"


# --- Đặt lại mật khẩu ---


async def test_reset_with_right_code_changes_password_and_revokes_tokens(
    client: AsyncClient,
    auth: dict[str, Any],
    outbox: list[SentEmail],
    test_engine: AsyncEngine,
) -> None:
    old_login = (await login(client, TEST_PASSWORD)).json()["tokens"]["refresh_token"]
    code = await request_code(client, outbox)

    response = await client.post(
        RESET,
        json={"email": EMAIL, "code": code, "new_password": NEW_PASSWORD, "device_name": "iPhone"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["email"] == EMAIL
    assert body["tokens"]["token_type"] == "bearer"
    me = await client.get(
        "/api/v1/me", headers={"Authorization": f"Bearer {body['tokens']['access_token']}"}
    )
    assert me.status_code == 200

    # mọi refresh token cũ (đăng ký và đăng nhập) đều bị thu hồi
    for old in (auth["tokens"]["refresh_token"], old_login):
        refreshed = await client.post("/api/v1/auth/refresh", json={"refresh_token": old})
        assert refreshed.status_code == 401
    new_refresh = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": body["tokens"]["refresh_token"]}
    )
    assert new_refresh.status_code == 200

    assert (await login(client, TEST_PASSWORD)).status_code == 401
    assert (await login(client, NEW_PASSWORD)).status_code == 200

    [row] = await codes_of(test_engine)
    assert row.used_at is not None


async def test_reset_code_cannot_be_reused(
    client: AsyncClient, auth: dict[str, Any], outbox: list[SentEmail]
) -> None:
    code = await request_code(client, outbox)
    assert (await reset(client, code)).status_code == 200

    again = await reset(client, code, new_password="matkhau-khac-789")

    assert again.status_code == 400
    assert error_code(again) == "INVALID_RESET_CODE"
    assert (await login(client, NEW_PASSWORD)).status_code == 200


async def test_reset_wrong_code_counts_attempts_and_fifth_invalidates(
    client: AsyncClient,
    auth: dict[str, Any],
    outbox: list[SentEmail],
    test_engine: AsyncEngine,
) -> None:
    code = await request_code(client, outbox)
    wrong = other_code(code)

    for attempt in range(1, 5):
        response = await reset(client, wrong)
        assert response.status_code == 400
        assert error_code(response) == "INVALID_RESET_CODE"
        [row] = await codes_of(test_engine)
        assert row.attempts == attempt
        assert row.used_at is None

    assert (await reset(client, wrong)).status_code == 400  # lần sai thứ 5
    [row] = await codes_of(test_engine)
    assert row.attempts == 5
    assert row.used_at is not None

    response = await reset(client, code)
    assert response.status_code == 400
    assert error_code(response) == "INVALID_RESET_CODE"
    assert (await login(client, TEST_PASSWORD)).status_code == 200


async def test_reset_right_code_after_some_wrong_attempts_works(
    client: AsyncClient, auth: dict[str, Any], outbox: list[SentEmail]
) -> None:
    code = await request_code(client, outbox)
    for _ in range(4):
        assert (await reset(client, other_code(code))).status_code == 400

    assert (await reset(client, code)).status_code == 200


async def test_reset_expired_code_is_rejected(
    client: AsyncClient, auth: dict[str, Any], outbox: list[SentEmail], clock: FakeClock
) -> None:
    code = await request_code(client, outbox)

    clock.advance(minutes=10)
    response = await reset(client, code)

    assert response.status_code == 400
    assert error_code(response) == "INVALID_RESET_CODE"


async def test_reset_just_before_expiry_works(
    client: AsyncClient, auth: dict[str, Any], outbox: list[SentEmail], clock: FakeClock
) -> None:
    code = await request_code(client, outbox)

    clock.advance(minutes=9, seconds=59)

    assert (await reset(client, code)).status_code == 200


async def test_reset_without_requesting_code_is_rejected(
    client: AsyncClient, auth: dict[str, Any]
) -> None:
    response = await reset(client, "123456")

    assert response.status_code == 400
    assert error_code(response) == "INVALID_RESET_CODE"


async def test_reset_unknown_email_looks_like_wrong_code(
    client: AsyncClient, auth: dict[str, Any], outbox: list[SentEmail]
) -> None:
    code = await request_code(client, outbox)
    wrong = await reset(client, other_code(code))

    unknown = await reset(client, code, email="khongco@example.com")

    assert unknown.status_code == wrong.status_code == 400
    assert unknown.json() == wrong.json()


async def test_reset_validation_errors(client: AsyncClient) -> None:
    for code in ["12345", "1234567", "12345a", "١٢٣٤٥٦"]:  # cả chữ số Ả Rập
        response = await reset(client, code)
        assert response.status_code == 422, code
        assert error_code(response) == "VALIDATION_ERROR"

    short = await reset(client, "123456", new_password="ngan")
    assert short.status_code == 422
    fields = {detail["field"] for detail in short.json()["error"]["details"]}
    assert fields == {"body.new_password"}

    bad_email = await reset(client, "123456", email="khong-phai-email")
    assert bad_email.status_code == 422


async def test_reset_is_rate_limited_per_ip(client: AsyncClient) -> None:
    for _ in range(10):
        assert (await reset(client, "123456")).status_code == 400

    response = await reset(client, "123456")
    assert response.status_code == 429
    assert error_code(response) == "RATE_LIMITED"
