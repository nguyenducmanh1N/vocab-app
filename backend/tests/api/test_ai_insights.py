"""POST /ai/insights (PLAN.md 9.12): họ từ, cụm đi kèm, mẹo nhớ, từ hay nhầm vào words."""

import json
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.config import get_settings
from app.models import AiGeneration, Word
from tests.conftest import FakeAi, accept_ai_consent

URL = "/api/v1/ai/insights"
ALL_PARTS = ["family", "collocations", "mnemonic", "confusables"]


@pytest.fixture
async def auth(client: AsyncClient, auth: dict[str, Any]) -> dict[str, Any]:
    """User A đã đồng ý dùng AI: mọi route /ai/* cần đồng ý (PLAN.md 9.16)."""
    return await accept_ai_consent(client, auth)


async def create_word(
    client: AsyncClient, auth: dict[str, Any], term: str = "decide", **fields: Any
) -> dict[str, Any]:
    list_id = (
        await client.post("/api/v1/lists", json={"name": f"List {term}"}, headers=auth["headers"])
    ).json()["id"]
    response = await client.post(
        f"/api/v1/lists/{list_id}/words",
        json={"term": term, "meaning_vi": "quyết định", **fields},
        headers=auth["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()


def insight_item(word_id: str, **overrides: Any) -> dict[str, Any]:
    """Kết quả Gemini giả cho một từ: mỗi phần có một mục hợp lệ."""
    return {
        "id": word_id,
        "word_family": [
            {
                "term": "decision",
                "part_of_speech": "noun",
                "meaning_vi": "sự quyết định",
                "example_en": "She made a quick decision.",
            }
        ],
        "collocations": [
            {
                "phrase": "make a decision",
                "meaning_vi": "đưa ra quyết định",
                "example_en": "We need to make a decision today.",
            }
        ],
        "mnemonic_vi": "decide nghe như 'đi sai' - quyết định sai thì phải đi lại.",
        "confusables": [
            {
                "term": "devise",
                "difference_vi": "devise là nghĩ ra, decide là quyết định.",
                "example_en": "I decided to stay home.",
                "other_example_en": "They devised a clever plan.",
            }
        ],
        **overrides,
    }


def set_result(fake_ai: FakeAi, items: list[dict[str, Any]]) -> None:
    fake_ai.json_by_schema["InsightResult"] = json.dumps({"items": items}, ensure_ascii=False)


async def db_word(engine: AsyncEngine, word_id: str) -> Word:
    async with AsyncSession(engine) as session:
        word = await session.scalar(select(Word).where(Word.id == uuid.UUID(word_id)))
        assert word is not None
        return word


async def test_insights_saves_checked_parts(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    word = await create_word(client, auth)
    set_result(fake_ai, [insight_item(word["id"])])

    response = await client.post(
        URL, json={"word_ids": [word["id"]], "parts": ALL_PARTS}, headers=auth["headers"]
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["remaining_today"] == get_settings().ai_insight_daily_limit - 1
    (out,) = body["words"]
    assert out["word_id"] == word["id"]
    assert out["mnemonic"].startswith("decide nghe như")
    assert [f["term"] for f in out["word_family"]] == ["decision"]
    assert [c["phrase"] for c in out["collocations"]] == ["make a decision"]
    assert [c["term"] for c in out["confusables"]] == ["devise"]
    # Lưu thẳng vào words, không chỉ trả về
    stored = await db_word(test_engine, word["id"])
    assert stored.mnemonic == out["mnemonic"]
    assert stored.word_family == out["word_family"]
    # Prompt gửi một lần cho cả lô, kèm id và term
    assert len(fake_ai.prompts) == 1
    assert word["id"] in fake_ai.prompts[0] and '"decide"' in fake_ai.prompts[0]


async def test_invalid_items_are_dropped(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    """Bước 3 của 9.12: ví dụ sai dạng, cụm không nằm trong ví dụ, confusable trùng từ → bỏ."""
    word = await create_word(client, auth)
    bad = insight_item(
        word["id"],
        word_family=[
            {
                "term": "decision",
                "part_of_speech": "noun",
                "meaning_vi": "sự quyết định",
                # Ví dụ không chứa đúng dạng "decision" → bị loại
                "example_en": "She decided quickly.",
            }
        ],
        collocations=[
            {
                "phrase": "make a decision",
                "meaning_vi": "đưa ra quyết định",
                "example_en": "We talked for hours.",  # không chứa cụm → bị loại
            }
        ],
        confusables=[
            {
                "term": "Decide",  # trùng chính từ đang học → bị loại
                "difference_vi": "trùng từ.",
                "example_en": "I decided to stay.",
                "other_example_en": "I decided to go.",
            }
        ],
    )
    set_result(fake_ai, [bad])

    response = await client.post(
        URL, json={"word_ids": [word["id"]], "parts": ALL_PARTS}, headers=auth["headers"]
    )

    assert response.status_code == 200, response.text
    (out,) = response.json()["words"]
    assert out["word_family"] == [] and out["collocations"] == [] and out["confusables"] == []
    assert out["mnemonic"]  # mẹo nhớ không có luật chứa từ, vẫn được giữ
    stored = await db_word(test_engine, word["id"])
    assert stored.word_family == [] and stored.collocations == [] and stored.confusables == []
    # Log chỉ chứa dữ liệu đã kiểm tra: mục bị loại không nằm trong result
    async with AsyncSession(test_engine) as session:
        generation = await session.scalar(
            select(AiGeneration).where(AiGeneration.kind == "insight")
        )
        assert generation is not None and generation.status == "ok"
        assert generation.result[0]["word_family"] == []


async def test_overwrite_false_keeps_existing(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    word = await create_word(client, auth, mnemonic="Mẹo tôi tự viết")
    set_result(fake_ai, [insight_item(word["id"])])

    response = await client.post(
        URL,
        json={"word_ids": [word["id"]], "parts": ALL_PARTS, "overwrite": False},
        headers=auth["headers"],
    )

    assert response.status_code == 200, response.text
    (out,) = response.json()["words"]
    assert out["mnemonic"] == "Mẹo tôi tự viết"  # không đè phần user đã có
    assert [f["term"] for f in out["word_family"]] == ["decision"]  # phần trống vẫn được điền
    assert (await db_word(test_engine, word["id"])).mnemonic == "Mẹo tôi tự viết"


async def test_overwrite_true_replaces(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    word = await create_word(client, auth, mnemonic="Mẹo tôi tự viết")
    set_result(fake_ai, [insight_item(word["id"])])

    response = await client.post(
        URL,
        json={"word_ids": [word["id"]], "parts": ["mnemonic"], "overwrite": True},
        headers=auth["headers"],
    )

    assert response.status_code == 200, response.text
    (out,) = response.json()["words"]
    assert out["mnemonic"].startswith("decide nghe như")
    assert out["word_family"] is None  # phần không yêu cầu không trả về
    stored = await db_word(test_engine, word["id"])
    assert stored.mnemonic == out["mnemonic"]
    assert stored.word_family == []  # phần không yêu cầu không bị động vào


async def test_other_users_word_is_404(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any], fake_ai: FakeAi
):
    other_auth = await accept_ai_consent(client, other_auth)
    word_a = await create_word(client, auth)
    word_b = await create_word(client, other_auth, term="deadline")
    set_result(fake_ai, [])

    response = await client.post(
        URL,
        json={"word_ids": [word_a["id"], word_b["id"]], "parts": ["mnemonic"]},
        headers=auth["headers"],
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    assert fake_ai.prompts == []  # chặn trước khi gọi Gemini


async def test_quota_exhausted_is_429(
    client: AsyncClient,
    auth: dict[str, Any],
    fake_ai: FakeAi,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(get_settings(), "ai_insight_daily_limit", 1)
    word = await create_word(client, auth)
    set_result(fake_ai, [insight_item(word["id"])])
    body = {"word_ids": [word["id"]], "parts": ["mnemonic"], "overwrite": True}

    first = await client.post(URL, json=body, headers=auth["headers"])
    assert first.status_code == 200, first.text
    assert first.json()["remaining_today"] == 0

    second = await client.post(URL, json=body, headers=auth["headers"])
    assert second.status_code == 429
    error = second.json()["error"]
    assert error["code"] == "AI_QUOTA_EXCEEDED" and error["details"]["resets_at"]


async def test_gemini_error_does_not_use_quota(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    word = await create_word(client, auth)
    fake_ai.fail = True

    response = await client.post(
        URL, json={"word_ids": [word["id"]], "parts": ["mnemonic"]}, headers=auth["headers"]
    )

    assert response.status_code == 502
    async with AsyncSession(test_engine) as session:
        generation = await session.scalar(
            select(AiGeneration).where(AiGeneration.kind == "insight")
        )
        assert generation is not None and generation.status == "error"
    fake_ai.fail = False
    set_result(fake_ai, [insight_item(word["id"])])
    retry = await client.post(
        URL, json={"word_ids": [word["id"]], "parts": ["mnemonic"]}, headers=auth["headers"]
    )
    assert retry.json()["remaining_today"] == get_settings().ai_insight_daily_limit - 1


async def test_validation_limits(client: AsyncClient, auth: dict[str, Any]):
    word_ids = [str(uuid.uuid4()) for _ in range(21)]
    too_many = await client.post(
        URL, json={"word_ids": word_ids, "parts": ["mnemonic"]}, headers=auth["headers"]
    )
    assert too_many.status_code == 422

    no_parts = await client.post(
        URL, json={"word_ids": [str(uuid.uuid4())], "parts": []}, headers=auth["headers"]
    )
    assert no_parts.status_code == 422
