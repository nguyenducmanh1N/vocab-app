"""GET /ai/quota: số lượt AI còn lại hôm nay."""

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
from app.core.time import local_today, start_of_local_day
from app.models import AiGeneration
from tests.conftest import FakeAi, accept_ai_consent

URL = "/api/v1/ai/quota"


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


async def test_quota_for_new_user(client: AsyncClient, auth: dict[str, Any]):
    response = await client.get(URL, headers=auth["headers"])

    assert response.status_code == 200
    body = response.json()
    settings = get_settings()
    assert body["suggest_remaining"] == settings.ai_suggest_daily_limit
    assert body["enrich_remaining"] == settings.ai_enrich_daily_limit
    assert body["speaking_remaining"] == settings.ai_speaking_daily_limit
    tz = auth["user"]["timezone"]
    tomorrow = start_of_local_day(local_today(tz) + timedelta(days=1), tz)
    assert datetime.fromisoformat(body["resets_at"]) == tomorrow


async def test_quota_counts_only_own_successful_calls(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    fake_ai: FakeAi,
    test_engine: AsyncEngine,
):
    body = {"topic": "Quán cà phê", "level": "B1", "count": 10, "word_types": ["word"]}
    await client.post("/api/v1/ai/suggest", json=body, headers=auth["headers"])
    await client.post("/api/v1/ai/suggest", json=body, headers=auth["headers"])  # cache: không trừ
    await client.post("/api/v1/ai/suggest", json=body, headers=other_auth["headers"])
    async with AsyncSession(test_engine) as session:
        session.add(
            AiGeneration(
                user_id=uuid.UUID(auth["user"]["id"]),
                kind="suggest",
                model="m",
                status="error",
                created_at=datetime.now(UTC),
            )
        )
        await session.commit()

    quota = (await client.get(URL, headers=auth["headers"])).json()

    assert quota["suggest_remaining"] == get_settings().ai_suggest_daily_limit - 1
    assert quota["enrich_remaining"] == get_settings().ai_enrich_daily_limit
    assert len(fake_ai.prompts) == 1  # B trúng cache dùng chung của A; xem quota không gọi Gemini


async def test_quota_requires_token(client: AsyncClient):
    assert (await client.get(URL)).status_code == 401
