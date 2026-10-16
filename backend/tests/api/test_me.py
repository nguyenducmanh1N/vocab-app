import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.db.base import Base
from app.models import (
    AiGeneration,
    DailyActivity,
    PasswordResetCode,
    ReviewLog,
    StudySession,
    User,
)
from tests.conftest import TEST_PASSWORD


async def patch_me(client: AsyncClient, auth: dict[str, Any], body: dict[str, Any]) -> Response:
    return await client.patch("/api/v1/me", json=body, headers=auth["headers"])


async def change_password(
    client: AsyncClient, auth: dict[str, Any], current: str, new: str = "matkhau-moi-456"
) -> Response:
    return await client.post(
        "/api/v1/me/password",
        json={"current_password": current, "new_password": new},
        headers=auth["headers"],
    )


def error_fields(response: Response) -> list[str]:
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    return [detail["field"] for detail in error["details"]]


# --- GET /me ---------------------------------------------------------------------------------


async def test_get_me_returns_profile_with_default_settings(
    client: AsyncClient, auth: dict[str, Any]
):
    response = await client.get("/api/v1/me", headers=auth["headers"])

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "an@example.com"
    assert body["timezone"] == "Asia/Ho_Chi_Minh"
    assert body["settings"]["daily_new_words"] == 10
    assert body["settings"]["notify"] == {
        "daily_reminder": True,
        "reminder_time": "20:00",
        "word_push": True,
        "word_push_per_day": 3,
        "window_start": "08:00",
        "window_end": "22:00",
        "streak_guard": True,
    }


async def test_get_me_requires_token(client: AsyncClient):
    response = await client.get("/api/v1/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "TOKEN_INVALID"


# --- PATCH /me -------------------------------------------------------------------------------


async def test_patch_notify_key_keeps_other_keys(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
):
    first = await patch_me(
        client,
        auth,
        {
            "settings": {
                "daily_new_words": 15,
                "notify": {"reminder_time": "21:00", "word_push_per_day": 4},
            }
        },
    )
    assert first.status_code == 200, first.text

    response = await patch_me(client, auth, {"settings": {"notify": {"word_push": False}}})

    assert response.status_code == 200
    settings = response.json()["settings"]
    assert settings["daily_new_words"] == 15
    assert settings["daily_goal_cards"] == 20  # mặc định
    assert settings["notify"]["reminder_time"] == "21:00"
    assert settings["notify"]["word_push_per_day"] == 4
    assert settings["notify"]["word_push"] is False
    assert settings["notify"]["window_end"] == "22:00"  # mặc định

    # DB chỉ lưu các khoá đã đặt; khoá thiếu lấy mặc định khi đọc ra
    async with AsyncSession(test_engine) as session:
        stored = await session.scalar(select(User.settings))
    assert stored == {
        "daily_new_words": 15,
        "notify": {"reminder_time": "21:00", "word_push_per_day": 4, "word_push": False},
    }

    again = await client.get("/api/v1/me", headers=auth["headers"])
    assert again.json()["settings"] == settings


async def test_daily_goal_cards_below_10_is_422(client: AsyncClient, auth: dict[str, Any]):
    response = await patch_me(client, auth, {"settings": {"daily_goal_cards": 5}})

    assert error_fields(response) == ["body.settings.daily_goal_cards"]


async def test_window_start_after_window_end_is_422(client: AsyncClient, auth: dict[str, Any]):
    # window_end đang là mặc định 22:00
    response = await patch_me(client, auth, {"settings": {"notify": {"window_start": "23:00"}}})

    assert error_fields(response) == ["body.settings.notify"]


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (
            {"settings": {"notify": {"reminder_time": "25:00"}}},
            "body.settings.notify.reminder_time",
        ),
        (
            {"settings": {"notify": {"word_push_per_day": 11}}},
            "body.settings.notify.word_push_per_day",
        ),
        ({"settings": {"speech_rate": 1.5}}, "body.settings.speech_rate"),
        ({"settings": {"theme": "blue"}}, "body.settings.theme"),
        ({"settings": {"khoa_la": 1}}, "body.settings.khoa_la"),
        ({"timezone": "Mars/Base"}, "body.timezone"),
        ({"level": "D1"}, "body.level"),
        ({"display_name": None}, "body"),
    ],
)
async def test_patch_invalid_values_are_422(
    client: AsyncClient, auth: dict[str, Any], body: dict[str, Any], field: str
):
    assert field in error_fields(await patch_me(client, auth, body))


async def test_word_push_per_day_accepts_up_to_10(client: AsyncClient, auth: dict[str, Any]):
    response = await patch_me(client, auth, {"settings": {"notify": {"word_push_per_day": 10}}})
    assert response.status_code == 200, response.text
    assert response.json()["settings"]["notify"]["word_push_per_day"] == 10


async def test_patch_profile_fields(client: AsyncClient, auth: dict[str, Any]):
    response = await patch_me(
        client,
        auth,
        {"display_name": "  Bình  ", "level": "C1", "timezone": "Europe/London"},
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["display_name"], body["level"], body["timezone"]) == (
        "Bình",
        "C1",
        "Europe/London",
    )


async def test_invalid_settings_do_not_save_other_fields(client: AsyncClient, auth: dict[str, Any]):
    response = await patch_me(
        client,
        auth,
        {"display_name": "Đổi tên", "settings": {"notify": {"window_end": "07:00"}}},
    )
    assert response.status_code == 422

    me = await client.get("/api/v1/me", headers=auth["headers"])
    assert me.json()["display_name"] == "An"
    assert me.json()["settings"]["notify"]["window_end"] == "22:00"


# --- POST /me/password -----------------------------------------------------------------------


async def test_change_password_wrong_current_is_401(client: AsyncClient, auth: dict[str, Any]):
    response = await change_password(client, auth, current="sai-mat-khau")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"


async def test_change_password_revokes_old_refresh_tokens(
    client: AsyncClient, auth: dict[str, Any]
):
    other_device = (
        await client.post(
            "/api/v1/auth/login", json={"email": "an@example.com", "password": TEST_PASSWORD}
        )
    ).json()["tokens"]

    response = await change_password(client, auth, current=TEST_PASSWORD)

    assert response.status_code == 200
    new_tokens = response.json()
    assert new_tokens["token_type"] == "bearer"

    for old in (auth["tokens"]["refresh_token"], other_device["refresh_token"]):
        reused = await client.post("/api/v1/auth/refresh", json={"refresh_token": old})
        assert reused.status_code == 401

    fresh = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": new_tokens["refresh_token"]}
    )
    assert fresh.status_code == 200


async def test_login_uses_new_password_after_change(client: AsyncClient, auth: dict[str, Any]):
    await change_password(client, auth, current=TEST_PASSWORD, new="matkhau-moi-456")

    old = await client.post(
        "/api/v1/auth/login", json={"email": "an@example.com", "password": TEST_PASSWORD}
    )
    new = await client.post(
        "/api/v1/auth/login", json={"email": "an@example.com", "password": "matkhau-moi-456"}
    )

    assert old.status_code == 401
    assert new.status_code == 200


# --- Xoá tài khoản (POST /me/delete) ---


async def delete_account(client: AsyncClient, auth: dict[str, Any], password: str) -> Response:
    return await client.post(
        "/api/v1/me/delete", json={"password": password}, headers=auth["headers"]
    )


async def seed_everything(client: AsyncClient, auth: dict[str, Any], engine: AsyncEngine) -> None:
    """Tạo ít nhất một dòng ở mọi bảng có user_id cho user này."""
    headers = auth["headers"]
    category = await client.post("/api/v1/categories", json={"name": "Cat"}, headers=headers)
    word_list = await client.post(
        "/api/v1/lists", json={"name": "L", "category_id": category.json()["id"]}, headers=headers
    )
    word = await client.post(
        f"/api/v1/lists/{word_list.json()['id']}/words",
        json={"term": "apple", "meaning_vi": "táo"},
        headers=headers,
    )
    user_id, word_id = uuid.UUID(auth["user"]["id"]), uuid.UUID(word.json()["id"])
    now = datetime.now(UTC)
    async with AsyncSession(engine) as session:
        study = StudySession(
            user_id=user_id, client_session_id=uuid.uuid4(), mode="flashcard", started_at=now
        )
        session.add(study)
        await session.flush()
        session.add_all(
            [
                ReviewLog(
                    user_id=user_id,
                    word_id=word_id,
                    session_id=study.id,
                    client_answer_id=uuid.uuid4(),
                    mode="flashcard",
                    quality=4,
                    is_correct=True,
                    is_first_attempt=True,
                    counted_for_srs=True,
                    reviewed_at=now,
                ),
                DailyActivity(user_id=user_id, activity_date=date.today()),
                AiGeneration(user_id=user_id, kind="suggest", model="m", status="ok"),
                PasswordResetCode(
                    user_id=user_id, code_hash="0" * 64, expires_at=now + timedelta(minutes=10)
                ),
            ]
        )
        await session.commit()


async def rows_per_table(engine: AsyncEngine, user_id: str) -> dict[str, int]:
    counts = {}
    async with engine.connect() as conn:
        for table in Base.metadata.sorted_tables:
            column = table.c.get("user_id") if table.name != "users" else table.c.id
            if column is None:
                continue
            counts[table.name] = await conn.scalar(
                select(func.count()).select_from(table).where(column == uuid.UUID(user_id))
            )
    return counts


async def test_delete_account_removes_every_row_of_the_user_only(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    test_engine: AsyncEngine,
) -> None:
    await seed_everything(client, auth, test_engine)
    await seed_everything(client, other_auth, test_engine)
    before = await rows_per_table(test_engine, auth["user"]["id"])
    assert all(count > 0 for count in before.values()), before  # thử đủ mọi bảng
    other_before = await rows_per_table(test_engine, other_auth["user"]["id"])

    response = await delete_account(client, auth, TEST_PASSWORD)

    assert response.status_code == 204
    assert set((await rows_per_table(test_engine, auth["user"]["id"])).values()) == {0}
    assert await rows_per_table(test_engine, other_auth["user"]["id"]) == other_before


async def test_after_delete_tokens_and_login_fail_and_email_is_free(
    client: AsyncClient, auth: dict[str, Any]
) -> None:
    assert (await delete_account(client, auth, TEST_PASSWORD)).status_code == 204

    me = await client.get("/api/v1/me", headers=auth["headers"])
    refresh = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": auth["tokens"]["refresh_token"]}
    )
    login = await client.post(
        "/api/v1/auth/login", json={"email": "an@example.com", "password": TEST_PASSWORD}
    )
    again = await client.post(
        "/api/v1/auth/register",
        json={"email": "an@example.com", "password": TEST_PASSWORD, "display_name": "An"},
    )

    assert (me.status_code, me.json()["error"]["code"]) == (401, "TOKEN_INVALID")
    assert refresh.status_code == 401
    assert login.status_code == 401
    assert again.status_code == 201


async def test_delete_account_wrong_password_deletes_nothing(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
) -> None:
    await seed_everything(client, auth, test_engine)
    before = await rows_per_table(test_engine, auth["user"]["id"])

    response = await delete_account(client, auth, "sai-mat-khau")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert await rows_per_table(test_engine, auth["user"]["id"]) == before
    assert (await client.get("/api/v1/me", headers=auth["headers"])).status_code == 200


async def test_delete_account_validation_token_and_rate_limit(
    client: AsyncClient, auth: dict[str, Any]
) -> None:
    missing = await client.post("/api/v1/me/delete", json={}, headers=auth["headers"])
    anonymous = await client.post("/api/v1/me/delete", json={"password": TEST_PASSWORD})
    assert error_fields(missing) == ["body.password"]
    assert anonymous.status_code == 401

    # 422 và 401 thiếu token dừng trước endpoint nên không tính; 5 lần/phút mỗi IP.
    for _ in range(5):
        assert (await delete_account(client, auth, "sai")).status_code == 401
    limited = await delete_account(client, auth, TEST_PASSWORD)
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "RATE_LIMITED"
