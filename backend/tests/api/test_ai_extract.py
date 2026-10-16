"""POST /ai/extract: lọc từ đáng học trong ảnh. Gemini giả, từ điển giả lập bằng respx."""

import base64
from collections.abc import Iterator
from typing import Any

import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.clients.dictionary import BASE_URL
from app.core.config import get_settings
from app.models import AiGeneration
from tests.conftest import FakeAi, accept_ai_consent

URL = "/api/v1/ai/extract"
IMAGE = base64.b64encode(b"\x89PNG fake image bytes").decode()


@pytest.fixture
async def auth(client: AsyncClient, auth: dict[str, Any]) -> dict[str, Any]:
    """User A đã đồng ý dùng AI: mọi route /ai/* cần đồng ý (PLAN.md 9.16)."""
    return await accept_ai_consent(client, auth)


@pytest.fixture(autouse=True)
def dictionary() -> Iterator[None]:
    with respx.mock(assert_all_called=False) as mock:
        mock.get(url__startswith=BASE_URL).respond(404, json={"title": "No Definitions Found"})
        yield


async def test_extract_returns_words_and_counts_as_suggestion(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    response = await client.post(
        URL,
        json={"image_base64": IMAGE, "mime_type": "image/png", "count": 10},
        headers=auth["headers"],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [w["term"] for w in body["words"]] == ["barista", "to go", "refill"]
    assert body["cached"] is False
    assert body["remaining_today"] == get_settings().ai_suggest_daily_limit - 1
    [images] = fake_ai.images
    assert images[0].data == b"\x89PNG fake image bytes" and images[0].mime_type == "image/png"
    async with AsyncSession(test_engine) as session:
        row = await session.scalar(select(AiGeneration))
    assert (row.kind, row.topic, row.cache_key) == ("suggest", "Từ trong ảnh", None)


async def test_extract_rejects_bad_image(client: AsyncClient, auth: dict[str, Any]):
    bad = await client.post(URL, json={"image_base64": "not base64!!"}, headers=auth["headers"])
    wrong_type = await client.post(
        URL, json={"image_base64": IMAGE, "mime_type": "text/plain"}, headers=auth["headers"]
    )

    assert bad.status_code == 422
    assert wrong_type.status_code == 422


async def test_extract_requires_token(client: AsyncClient):
    assert (await client.post(URL, json={"image_base64": IMAGE})).status_code == 401
