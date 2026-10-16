"""POST /ai/enrich (PLAN.md 9.8). Gemini thay bằng FakeAi, từ điển giả lập bằng respx."""

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

URL = "/api/v1/ai/enrich"
NO_SOURCE = {"source": None, "source_id": None, "source_url": None}  # ví dụ AI chưa ghi nguồn


def dictionary_fixture(name: str) -> Any:
    return json.loads((FIXTURES_DIR / f"dictionary_{name}.json").read_text())


@pytest.fixture
async def auth(client: AsyncClient, auth: dict[str, Any]) -> dict[str, Any]:
    """User A đã đồng ý dùng AI: mọi route /ai/* cần đồng ý (PLAN.md 9.16)."""
    return await accept_ai_consent(client, auth)


@pytest.fixture(autouse=True)
def dictionary() -> Iterator[respx.MockRouter]:
    """Mọi test trong file giả lập từ điển; từ không khai báo trả 404. Không gọi mạng thật."""
    with respx.mock(assert_all_called=False) as mock:
        mock.get(BASE_URL + "deadline").respond(200, json=dictionary_fixture("deadline"))
        mock.get(url__startswith=BASE_URL).respond(404, json={"title": "No Definitions Found"})
        yield mock


async def generations(engine: AsyncEngine) -> list[AiGeneration]:
    async with AsyncSession(engine) as session:
        return list(await session.scalars(select(AiGeneration).order_by(AiGeneration.created_at)))


async def test_enrich_fills_all_fields(
    client: AsyncClient,
    auth: dict[str, Any],
    fake_ai: FakeAi,
    dictionary: respx.MockRouter,
    test_engine: AsyncEngine,
):
    fake_ai.fixture = "gemini_enrich.json"
    # "deadline" đã có trong một list của user → already_saved
    list_id = (
        await client.post("/api/v1/lists", json={"name": "Công việc"}, headers=auth["headers"])
    ).json()["id"]
    await client.post(
        f"/api/v1/lists/{list_id}/words",
        json={"term": "deadline", "meaning_vi": "hạn chót"},
        headers=auth["headers"],
    )

    response = await client.post(
        URL,
        json={"terms": [" Deadline ", "meet the deadline", "xyzzyq", "DEADLINE"]},
        headers=auth["headers"],
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["remaining_today"] == get_settings().ai_enrich_daily_limit - 1
    assert body["unknown_terms"] == ["xyzzyq"]
    deadline, phrase = body["words"]
    assert deadline == {
        "term": "deadline",
        "part_of_speech": "noun",
        "ipa": "/ˈdɛdˌlaɪn/",  # từ điển ghi đè IPA của Gemini
        "meaning_vi": "hạn chót; thời hạn cuối cùng",
        "synonyms": ["due date", "time limit"],  # bỏ chính từ đó khỏi đồng nghĩa
        "examples": [
            {
                "en": "We must finish the report before the deadline.",
                "vi": "Chúng ta phải xong báo cáo trước hạn chót.",
                **NO_SOURCE,
            },
            {
                "en": "The deadline is next Friday.",
                "vi": "Hạn chót là thứ Sáu tuần sau.",
                **NO_SOURCE,
            },
        ],
        "audio_url": "https://api.dictionaryapi.dev/media/pronunciations/en/deadline-uk.mp3",
        "definition_en": (
            "A time limit in the form of a date on or before which something must be completed.\n"
            "A guideline marked on a plate for a printing press.\n"
            "A line that does not move."
        ),  # định nghĩa tiếng Anh từ từ điển (tối đa 3)
        "already_saved": True,
        "cloze_ready": True,
        "corrected_from": None,
    }
    assert phrase["term"] == "meet the deadline"  # đã chuẩn hoá khoảng trắng
    assert phrase["ipa"] == "/miːt ðə ˈdedlaɪn/"  # từ điển không có → giữ IPA của Gemini
    assert phrase["audio_url"] is None
    assert phrase["already_saved"] is False
    assert phrase["cloze_ready"] is False  # câu ví dụ không chứa cụm từ
    assert phrase["definition_en"] is None  # từ điển không có → không lưu

    # Prompt gửi đi đã chuẩn hoá, bỏ trùng, theo trình độ của user
    assert '["deadline", "meet the deadline", "xyzzyq"]' in fake_ai.prompts[0]
    assert "(CEFR B1)" in fake_ai.prompts[0]
    [row] = await generations(test_engine)
    assert (row.kind, row.status, row.model, row.word_count, row.level) == (
        "enrich",
        "ok",
        "fake-model",
        3,
        "B1",
    )
    assert row.result["unknown_terms"] == ["xyzzyq"]


async def test_upstream_error_is_502_and_not_counted(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    fake_ai.fail = True

    response = await client.post(URL, json={"terms": ["deadline"]}, headers=auth["headers"])

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_UPSTREAM_ERROR"
    [row] = await generations(test_engine)
    assert row.status == "error"

    # Lần lỗi không tính vào hạn mức
    fake_ai.fail = False
    fake_ai.fixture = "gemini_enrich.json"
    ok = await client.post(URL, json={"terms": ["deadline"]}, headers=auth["headers"])
    assert ok.json()["remaining_today"] == get_settings().ai_enrich_daily_limit - 1


async def test_quota_exceeded_is_429_with_resets_at(
    client: AsyncClient,
    auth: dict[str, Any],
    fake_ai: FakeAi,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(get_settings(), "ai_enrich_daily_limit", 2)
    user_id = uuid.UUID(auth["user"]["id"])
    tz = auth["user"]["timezone"]
    today_start = start_of_local_day(local_today(tz), tz)
    async with AsyncSession(test_engine) as session:
        session.add_all(
            [
                # Hôm qua (giờ local) và dòng lấy từ cache không tính lượt
                AiGeneration(
                    user_id=user_id,
                    kind="enrich",
                    model="m",
                    status="ok",
                    created_at=today_start - timedelta(minutes=1),
                ),
                AiGeneration(
                    user_id=user_id,
                    kind="enrich",
                    model="cache",
                    status="ok",
                    created_at=today_start + timedelta(minutes=1),
                ),
                AiGeneration(
                    user_id=user_id,
                    kind="suggest",
                    model="m",
                    status="ok",
                    created_at=today_start + timedelta(minutes=1),
                ),
                # Hôm nay: 2 lượt → đã hết
                AiGeneration(
                    user_id=user_id,
                    kind="enrich",
                    model="m",
                    status="ok",
                    created_at=today_start + timedelta(minutes=1),
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

    response = await client.post(URL, json={"terms": ["deadline"]}, headers=auth["headers"])

    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "AI_QUOTA_EXCEEDED"
    resets_at = datetime.fromisoformat(error["details"]["resets_at"])
    assert resets_at == start_of_local_day(local_today(tz) + timedelta(days=1), tz)
    assert fake_ai.prompts == []  # không gọi Gemini khi hết lượt


@pytest.mark.parametrize(
    "body",
    [
        {"terms": []},
        {"terms": [f"w{i}" for i in range(31)]},
        {"terms": [" "]},
        {"terms": ["x"], "level": "Z9"},
    ],
)
async def test_validation_error(client: AsyncClient, auth: dict[str, Any], body: dict):
    assert (await client.post(URL, json=body, headers=auth["headers"])).status_code == 422


async def test_requires_token(client: AsyncClient):
    assert (await client.post(URL, json={"terms": ["x"]})).status_code == 401


async def test_missing_api_key_gives_clear_502(app: Any, client: AsyncClient, auth: dict[str, Any]):
    from app.api.v1.deps import get_ai_client
    from app.clients.gemini import MissingKeyClient

    app.dependency_overrides[get_ai_client] = MissingKeyClient

    response = await client.post(URL, json={"terms": ["deadline"]}, headers=auth["headers"])

    assert response.status_code == 502
    assert "GEMINI_API_KEY" in response.json()["error"]["message"]


async def test_enrich_keeps_request_order(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi
):
    # Fixture trả "deadline" trước "meet the deadline"; kết quả phải theo thứ tự request.
    fake_ai.fixture = "gemini_enrich.json"

    response = await client.post(
        URL, json={"terms": ["meet the deadline", "xyzzyq", "deadline"]}, headers=auth["headers"]
    )

    body = response.json()
    assert [w["term"] for w in body["words"]] == ["meet the deadline", "deadline"]
    assert body["unknown_terms"] == ["xyzzyq"]


async def test_enrich_is_never_cached(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
):
    fake_ai.fixture = "gemini_enrich.json"
    limit = get_settings().ai_enrich_daily_limit

    first = await client.post(URL, json={"terms": ["deadline"]}, headers=auth["headers"])
    second = await client.post(URL, json={"terms": ["deadline"]}, headers=auth["headers"])

    assert len(fake_ai.prompts) == 2  # gọi Gemini cả hai lần
    assert first.json()["remaining_today"] == limit - 1
    assert second.json()["remaining_today"] == limit - 2
    rows = await generations(test_engine)
    assert [(r.status, r.model) for r in rows] == [("ok", "fake-model"), ("ok", "fake-model")]


async def test_enrich_returns_spelling_corrections(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi
):
    # Gemini sửa "recieve" → "receive" và trả thêm "elephant" không liên quan (không được nhận).
    fake_ai.fixture = "gemini_enrich_corrected.json"

    response = await client.post(
        URL, json={"terms": ["recieve", "deadline", "xyzzyq"]}, headers=auth["headers"]
    )

    body = response.json()
    assert [(w["term"], w["corrected_from"]) for w in body["words"]] == [
        ("receive", "recieve"),
        ("deadline", None),
    ]
    assert body["unknown_terms"] == ["xyzzyq"]
    assert "corrected spelling" in fake_ai.prompts[0]
