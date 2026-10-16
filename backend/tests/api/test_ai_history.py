"""GET /ai/history và /ai/history/{id} (PLAN.md 8.3). Gemini giả, từ điển giả lập bằng respx."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import respx
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.clients.dictionary import BASE_URL
from app.core.config import get_settings
from app.models import AiGeneration
from tests.conftest import FakeAi, accept_ai_consent

HISTORY = "/api/v1/ai/history"


@pytest.fixture
async def auth(client: AsyncClient, auth: dict[str, Any]) -> dict[str, Any]:
    """User A đã đồng ý dùng AI: mọi route /ai/* cần đồng ý (PLAN.md 9.16)."""
    return await accept_ai_consent(client, auth)


@pytest.fixture
async def other_auth(client: AsyncClient, other_auth: dict[str, Any]) -> dict[str, Any]:
    return await accept_ai_consent(client, other_auth)


@pytest.fixture(autouse=True)
def dictionary() -> Iterator[None]:
    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith=BASE_URL).respond(404, json={"title": "No Definitions Found"})
        yield


async def suggest(client: AsyncClient, auth: dict[str, Any], topic: str) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/ai/suggest",
        json={"topic": topic, "level": "B1", "count": 10, "word_types": ["word"]},
        headers=auth["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_history_lists_only_own_successful_suggestions(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    fake_ai: FakeAi,
    test_engine: AsyncEngine,
):
    first = await suggest(client, auth, "Quán cà phê")
    second = await suggest(client, auth, "Sân bay")
    cached = await suggest(client, auth, "quán cà phê")  # dòng model='cache'
    assert cached["cached"] is True
    other = await suggest(client, other_auth, "Của B")
    user_id = uuid.UUID(auth["user"]["id"])
    async with AsyncSession(test_engine) as session:
        session.add_all(
            [
                AiGeneration(
                    user_id=user_id,
                    kind="suggest",
                    topic="Lỗi",
                    model="m",
                    status="error",
                    created_at=datetime.now(UTC),
                ),
                AiGeneration(
                    user_id=user_id,
                    kind="enrich",
                    model="m",
                    status="ok",
                    result={"words": []},
                    created_at=datetime.now(UTC),
                ),
            ]
        )
        await session.commit()

    response = await client.get(HISTORY, headers=auth["headers"])

    assert response.status_code == 200
    items = response.json()
    assert [i["generation_id"] for i in items] == [second["generation_id"], first["generation_id"]]
    assert items[0] == {
        "generation_id": second["generation_id"],
        "topic": "Sân bay",
        "level": "B1",
        "word_count": 10,
        "created_at": items[0]["created_at"],
    }
    ids = {i["generation_id"] for i in items}
    assert cached["generation_id"] not in ids and other["generation_id"] not in ids


async def test_history_limit(client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi):
    for topic in ["Một", "Hai", "Ba"]:
        await suggest(client, auth, topic)

    items = (await client.get(HISTORY, params={"limit": 2}, headers=auth["headers"])).json()

    assert [i["topic"] for i in items] == ["Ba", "Hai"]
    assert (
        await client.get(HISTORY, params={"limit": 51}, headers=auth["headers"])
    ).status_code == 422


async def test_history_detail_recomputes_already_saved(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi
):
    generation = await suggest(client, auth, "Quán cà phê")
    url = f"{HISTORY}/{generation['generation_id']}"
    before = (await client.get(url, headers=auth["headers"])).json()
    assert all(w["already_saved"] is False for w in before["words"])
    assert before["cached"] is False
    assert before["remaining_today"] == get_settings().ai_suggest_daily_limit - 1  # không tốn lượt

    list_id = (
        await client.post("/api/v1/lists", json={"name": "Cà phê"}, headers=auth["headers"])
    ).json()["id"]
    await client.post(
        f"/api/v1/lists/{list_id}/words",
        json={"term": "barista", "meaning_vi": "nhân viên pha chế"},
        headers=auth["headers"],
    )

    after = (await client.get(url, headers=auth["headers"])).json()

    assert {w["term"]: w["already_saved"] for w in after["words"]} == {
        "barista": True,
        "to go": False,
        "refill": False,
    }
    assert len(fake_ai.prompts) == 1  # xem lịch sử không gọi Gemini


async def test_history_detail_hides_other_users_errors_and_cache_rows(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    fake_ai: FakeAi,
    test_engine: AsyncEngine,
):
    await suggest(client, auth, "Quán cà phê")
    cached = await suggest(client, auth, "Quán cà phê")
    other = await suggest(client, other_auth, "Của B")
    user_id = uuid.UUID(auth["user"]["id"])
    failed_id = uuid.uuid4()
    async with AsyncSession(test_engine) as session:
        session.add(
            AiGeneration(
                id=failed_id,
                user_id=user_id,
                kind="suggest",
                model="m",
                status="error",
                created_at=datetime.now(UTC) - timedelta(minutes=1),
            )
        )
        await session.commit()

    for generation_id in [
        other["generation_id"],
        cached["generation_id"],
        failed_id,
        str(uuid.uuid4()),
    ]:
        response = await client.get(f"{HISTORY}/{generation_id}", headers=auth["headers"])
        assert response.status_code == 404, generation_id
        assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_history_requires_token(client: AsyncClient):
    assert (await client.get(HISTORY)).status_code == 401
