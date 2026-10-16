"""POST /ai/suggest (PLAN.md 9.7). Gemini thay bằng FakeAi, từ điển giả lập bằng respx."""

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.clients.dictionary import BASE_URL
from app.core.config import get_settings
from app.core.time import local_today, start_of_local_day
from app.models import AiGeneration
from tests.conftest import FIXTURES_DIR, FakeAi, accept_ai_consent

URL = "/api/v1/ai/suggest"
BODY = {"topic": "Quán cà phê", "level": "B1", "count": 10, "word_types": ["word", "phrase"]}
BARISTA = {
    "word": "barista",
    "phonetic": "/bəˈɹiːstə/",
    "phonetics": [
        {"text": "/bəˈɹiːstə/", "audio": "https://example.com/barista-us.mp3"},
    ],
    "meanings": [{"partOfSpeech": "noun", "definitions": [{"definition": "A coffee maker."}]}],
}


@pytest.fixture
async def auth(client: AsyncClient, auth: dict[str, Any]) -> dict[str, Any]:
    """User A đã đồng ý dùng AI: mọi route /ai/* cần đồng ý (PLAN.md 9.16)."""
    return await accept_ai_consent(client, auth)


@pytest.fixture
async def other_auth(client: AsyncClient, other_auth: dict[str, Any]) -> dict[str, Any]:
    return await accept_ai_consent(client, other_auth)


@pytest.fixture(autouse=True)
def dictionary() -> Iterator[respx.MockRouter]:
    """Từ điển giả: chỉ "barista" có kết quả, từ khác trả 404 JSON. Không gọi mạng thật."""
    with respx.mock(assert_all_called=False) as mock:
        mock.get(BASE_URL + "barista").respond(200, json=[BARISTA])
        mock.get(url__startswith=BASE_URL).respond(404, json={"title": "No Definitions Found"})
        yield mock


async def suggest(client: AsyncClient, auth: dict[str, Any], **overrides: Any):
    return await client.post(URL, json={**BODY, **overrides}, headers=auth["headers"])


async def generations(engine: AsyncEngine) -> list[AiGeneration]:
    async with AsyncSession(engine) as session:
        return list(await session.scalars(select(AiGeneration).order_by(AiGeneration.created_at)))


async def test_suggest_success(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    response = await suggest(client, auth)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cached"] is False
    assert body["remaining_today"] == get_settings().ai_suggest_daily_limit - 1
    terms = [w["term"] for w in body["words"]]
    assert terms == ["barista", "to go", "refill"]  # fixture chỉ có 3 từ: thiếu thì thôi
    barista = body["words"][0]
    assert barista["ipa"] == "/bəˈɹiːstə/"  # từ điển ghi đè
    assert barista["audio_url"] == "https://example.com/barista-us.mp3"
    assert barista["cloze_ready"] is True
    assert body["words"][2]["cloze_ready"] is True  # "refill" có trong câu "Free refills…"

    prompt = fake_ai.prompts[0]
    assert 'Topic: "Quán cà phê"' in prompt and "Return exactly 10" in prompt
    assert "Allowed item types: phrase, word." in prompt
    [row] = await generations(test_engine)
    assert (row.kind, row.status, row.model) == ("suggest", "ok", "fake-model")
    assert row.cache_key == "quan ca phe|B1|10|phrase,word"
    assert str(row.id) == body["generation_id"]
    assert "already_saved" not in row.result[0]


async def test_same_params_return_cache_without_calling_gemini(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    first = (await suggest(client, auth)).json()

    # Khác hoa thường, dấu, khoảng trắng và thứ tự word_types → cùng cache_key
    second = await suggest(
        client, auth, topic="  QUAN  ca phe ", word_types=["phrase", "word", "word"]
    )

    assert second.status_code == 200
    body = second.json()
    assert body["cached"] is True
    assert len(fake_ai.prompts) == 1  # Gemini không bị gọi lần hai
    assert body["remaining_today"] == first["remaining_today"]  # không tính lượt
    assert [w["term"] for w in body["words"]] == [w["term"] for w in first["words"]]
    rows = await generations(test_engine)
    assert [r.model for r in rows] == ["fake-model", "cache"]
    assert body["generation_id"] == str(rows[1].id)


@pytest.mark.parametrize(
    "change", [{"level": "B2"}, {"count": 20}, {"word_types": ["idiom"]}, {"exclude_terms": ["x"]}]
)
async def test_cache_not_used_when_params_differ(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, change: dict[str, Any]
):
    await suggest(client, auth)

    response = await suggest(client, auth, **change)

    assert response.json()["cached"] is False
    assert len(fake_ai.prompts) == 2


async def test_cache_expires_after_7_days(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    await suggest(client, auth)
    async with AsyncSession(test_engine) as session:
        row = await session.scalar(select(AiGeneration))
        assert row is not None
        row.created_at = datetime.now(UTC) - timedelta(days=7, minutes=1)
        await session.commit()

    response = await suggest(client, auth)

    assert response.json()["cached"] is False
    assert len(fake_ai.prompts) == 2


async def test_exclude_terms_never_returned(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi
):
    response = await suggest(client, auth, exclude_terms=["  BARISTA ", "to  go"])

    terms = [w["term"] for w in response.json()["words"]]
    assert "barista" not in terms and "to go" not in terms
    assert terms == ["refill"]
    assert '["barista", "to go"]' in fake_ai.prompts[0]  # đã gửi danh sách loại trừ cho Gemini


async def test_result_cut_to_count(client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi):
    fake_ai.fixture = "gemini_suggest_many.json"  # 12 từ

    body = (await suggest(client, auth, count=10)).json()

    assert len(body["words"]) == 10


async def test_already_saved(client: AsyncClient, auth: dict[str, Any]):
    list_id = (
        await client.post("/api/v1/lists", json={"name": "Cà phê"}, headers=auth["headers"])
    ).json()["id"]
    await client.post(
        f"/api/v1/lists/{list_id}/words",
        json={"term": "Refill", "meaning_vi": "rót thêm"},
        headers=auth["headers"],
    )

    words = (await suggest(client, auth)).json()["words"]

    assert {w["term"]: w["already_saved"] for w in words} == {
        "barista": False,
        "to go": False,
        "refill": True,
    }


async def test_quota_exceeded_is_429_with_resets_at(
    client: AsyncClient,
    auth: dict[str, Any],
    fake_ai: FakeAi,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(get_settings(), "ai_suggest_daily_limit", 1)
    user_id = uuid.UUID(auth["user"]["id"])
    tz = auth["user"]["timezone"]
    today_start = start_of_local_day(local_today(tz), tz)
    async with AsyncSession(test_engine) as session:
        session.add_all(
            [
                # Không tính: hôm qua, dòng cache, lượt lỗi, lượt enrich
                AiGeneration(
                    user_id=user_id,
                    kind="suggest",
                    model="m",
                    status="ok",
                    created_at=today_start - timedelta(minutes=1),
                ),
                AiGeneration(
                    user_id=user_id,
                    kind="suggest",
                    model="cache",
                    status="ok",
                    created_at=datetime.now(UTC),
                ),
                AiGeneration(
                    user_id=user_id,
                    kind="suggest",
                    model="m",
                    status="error",
                    created_at=datetime.now(UTC),
                ),
                AiGeneration(
                    user_id=user_id,
                    kind="enrich",
                    model="m",
                    status="ok",
                    created_at=datetime.now(UTC),
                ),
            ]
        )
        await session.commit()

    first = await suggest(client, auth)
    assert first.status_code == 200 and first.json()["remaining_today"] == 0

    second = await suggest(client, auth, topic="Sân bay")

    assert second.status_code == 429
    error = second.json()["error"]
    assert error["code"] == "AI_QUOTA_EXCEEDED"
    resets_at = datetime.fromisoformat(error["details"]["resets_at"])
    assert resets_at == start_of_local_day(local_today(tz) + timedelta(days=1), tz)
    assert len(fake_ai.prompts) == 1


async def test_gemini_failure_is_502_and_logged(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    fake_ai.fail = True  # cả 2 model đều lỗi

    response = await suggest(client, auth)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_UPSTREAM_ERROR"
    [row] = await generations(test_engine)
    assert (row.kind, row.status, row.cache_key) == (
        "suggest",
        "error",
        "quan ca phe|B1|10|phrase,word",
    )


@pytest.mark.parametrize(
    "change",
    [
        {"count": 15},
        {"word_types": []},
        {"word_types": ["slang"]},
        {"topic": "a"},
        {"topic": "x" * 101},
        {"exclude_terms": ["w"] * 201},
        {"level": "Z9"},
    ],
)
async def test_suggest_validation_error(
    client: AsyncClient, auth: dict[str, Any], change: dict[str, Any]
):
    assert (await suggest(client, auth, **change)).status_code == 422


async def test_suggest_requires_token(client: AsyncClient):
    assert (await client.post(URL, json=BODY)).status_code == 401


def test_suggest_fixture_has_more_words_than_count() -> None:
    data = json.loads((FIXTURES_DIR / "gemini_suggest_many.json").read_text())
    assert len(data["words"]) > 10


async def test_cache_is_shared_between_users(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    fake_ai: FakeAi,
):
    await add_saved_word(client, other_auth, "refill")
    first = (await suggest(client, auth)).json()

    response = await suggest(client, other_auth)

    body = response.json()
    assert body["cached"] is True
    assert len(fake_ai.prompts) == 1  # user B dùng lại kết quả của user A, không gọi Gemini
    assert body["remaining_today"] == get_settings().ai_suggest_daily_limit  # B không tốn lượt
    assert [w["term"] for w in body["words"]] == [w["term"] for w in first["words"]]
    # already_saved tính theo từng user
    assert {w["term"]: w["already_saved"] for w in first["words"]}["refill"] is False
    assert {w["term"]: w["already_saved"] for w in body["words"]}["refill"] is True


async def add_saved_word(client: AsyncClient, auth: dict[str, Any], term: str) -> None:
    list_id = (
        await client.post("/api/v1/lists", json={"name": "L"}, headers=auth["headers"])
    ).json()["id"]
    await client.post(
        f"/api/v1/lists/{list_id}/words",
        json={"term": term, "meaning_vi": "nghĩa"},
        headers=auth["headers"],
    )
