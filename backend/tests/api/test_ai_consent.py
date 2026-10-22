"""Đồng ý dùng AI (PLAN.md 9.16): mọi route /ai/* trả 403 khi chưa đồng ý."""

import uuid
from datetime import datetime
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, Response

from app.core.config import get_settings
from tests.conftest import FakeClock

CONSENT_URL = "/api/v1/me/ai-consent"

# Mọi route /ai/* hiện có; test_list_covers_every_ai_route giữ danh sách này đủ.
AI_ROUTES = [
    ("POST", "/api/v1/ai/enrich"),
    ("POST", "/api/v1/ai/suggest"),
    ("GET", "/api/v1/ai/history"),
    ("GET", "/api/v1/ai/history/{generation_id}"),
    ("GET", "/api/v1/ai/quota"),
    ("POST", "/api/v1/ai/extract"),
    ("POST", "/api/v1/ai/insights"),
    ("POST", "/api/v1/ai/speaking-feedback"),
]


async def call(client: AsyncClient, auth: dict[str, Any], method: str, path: str) -> Response:
    """Gọi route với body rỗng: chưa đồng ý thì phải 403 trước cả bước validate body."""
    url = path.replace("{generation_id}", str(uuid.uuid4()))
    body = {"json": {}} if method == "POST" else {}
    return await client.request(method, url, headers=auth["headers"], **body)


async def set_consent(client: AsyncClient, auth: dict[str, Any], accepted: bool) -> Response:
    return await client.post(CONSENT_URL, json={"accepted": accepted}, headers=auth["headers"])


async def assert_blocked(client: AsyncClient, auth: dict[str, Any]) -> None:
    for method, path in AI_ROUTES:
        response = await call(client, auth, method, path)
        assert response.status_code == 403, (method, path, response.text)
        assert response.json()["error"]["code"] == "AI_CONSENT_REQUIRED"


async def assert_allowed(client: AsyncClient, auth: dict[str, Any]) -> None:
    for method, path in AI_ROUTES:
        response = await call(client, auth, method, path)
        assert response.status_code != 403, (method, path, response.text)
    assert (await client.get("/api/v1/ai/quota", headers=auth["headers"])).status_code == 200


def test_list_covers_every_ai_route(app: FastAPI) -> None:
    routes = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith("/api/v1/ai/")
        for method in operations
    }
    assert routes == set(AI_ROUTES)


@pytest.mark.parametrize(("method", "path"), AI_ROUTES)
async def test_ai_route_without_consent_is_403(
    client: AsyncClient, auth: dict[str, Any], method: str, path: str
) -> None:
    response = await call(client, auth, method, path)

    assert response.status_code == 403, response.text
    assert response.json()["error"]["code"] == "AI_CONSENT_REQUIRED"


async def test_new_user_has_no_consent(client: AsyncClient, auth: dict[str, Any]) -> None:
    assert (auth["user"]["ai_consent_at"], auth["user"]["ai_consent_version"]) == (None, None)


async def test_accept_then_withdraw(
    client: AsyncClient, auth: dict[str, Any], clock: FakeClock
) -> None:
    accepted = await set_consent(client, auth, True)

    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert datetime.fromisoformat(body["ai_consent_at"]) == clock()
    assert body["ai_consent_version"] == get_settings().ai_consent_version
    me = (await client.get("/api/v1/me", headers=auth["headers"])).json()
    assert (me["ai_consent_at"], me["ai_consent_version"]) == (
        body["ai_consent_at"],
        body["ai_consent_version"],
    )
    await assert_allowed(client, auth)

    withdrawn = await set_consent(client, auth, False)

    assert withdrawn.json() == {"ai_consent_at": None, "ai_consent_version": None}
    me = (await client.get("/api/v1/me", headers=auth["headers"])).json()
    assert (me["ai_consent_at"], me["ai_consent_version"]) == (None, None)
    await assert_blocked(client, auth)


async def test_consent_is_per_user(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    await set_consent(client, auth, True)

    await assert_allowed(client, auth)
    await assert_blocked(client, other_auth)


async def test_new_consent_version_asks_again(
    app: FastAPI, client: AsyncClient, auth: dict[str, Any]
) -> None:
    await set_consent(client, auth, True)
    await assert_allowed(client, auth)

    # Nội dung màn đồng ý đổi → tăng AI_CONSENT_VERSION.
    bumped = get_settings().model_copy(update={"ai_consent_version": 2})
    app.dependency_overrides[get_settings] = lambda: bumped

    await assert_blocked(client, auth)
    me = (await client.get("/api/v1/me", headers=auth["headers"])).json()
    assert me["ai_consent_version"] == 1  # app thấy đã đồng ý bản cũ

    again = await set_consent(client, auth, True)

    assert again.json()["ai_consent_version"] == 2
    await assert_allowed(client, auth)


@pytest.mark.parametrize("body", [{}, {"accepted": "có"}, {"accepted": True, "khoa_la": 1}])
async def test_consent_validation_error(
    client: AsyncClient, auth: dict[str, Any], body: dict[str, Any]
) -> None:
    response = await client.post(CONSENT_URL, json=body, headers=auth["headers"])

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_consent_requires_login(client: AsyncClient) -> None:
    response = await client.post(CONSENT_URL, json={"accepted": True})

    assert response.status_code == 401
