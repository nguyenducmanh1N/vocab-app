"""POST /ai/speaking-feedback: Gemini (giả) nghe bản ghi luyện nói và nhận xét (PLAN.md 9.11)."""

import base64
import json
from datetime import datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.config import get_settings
from app.core.time import local_today, start_of_local_day
from app.models import AiGeneration
from app.services import ai_service
from tests.conftest import FIXTURES_DIR, FakeAi, accept_ai_consent

URL = "/api/v1/ai/speaking-feedback"
AUDIO_BYTES = b"\x00\x00\x00\x1cftypM4A fake recording bytes"
AUDIO = base64.b64encode(AUDIO_BYTES).decode()
REFERENCE = "The barista made my coffee to go."
EVALUATION = (FIXTURES_DIR / "gemini_speaking_evaluation.json").read_text()


def heard(transcript: str) -> str:
    return json.dumps({"transcript": transcript})


@pytest.fixture
async def auth(client: AsyncClient, auth: dict[str, Any]) -> dict[str, Any]:
    """User A đã đồng ý dùng AI: mọi route /ai/* cần đồng ý (PLAN.md 9.16)."""
    return await accept_ai_consent(client, auth)


@pytest.fixture(autouse=True)
def gemini_answers(fake_ai: FakeAi) -> None:
    fake_ai.json_by_schema = {
        "SpeakingTranscript": (FIXTURES_DIR / "gemini_speaking_transcript.json").read_text(),
        "SpeakingEvaluation": EVALUATION,
    }


async def post(client: AsyncClient, auth: dict[str, Any], **body: Any) -> Response:
    payload = {"audio_base64": AUDIO, "reference_text": REFERENCE, "term": "barista", **body}
    return await client.post(URL, json=payload, headers=auth["headers"])


async def rows(test_engine: AsyncEngine) -> list[AiGeneration]:
    async with AsyncSession(test_engine) as session:
        return list(await session.scalars(select(AiGeneration).order_by(AiGeneration.created_at)))


async def test_feedback_transcribes_blind_then_evaluates(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
) -> None:
    response = await post(client, auth)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["transcript"] == "They be ready to make my coffee to go."
    assert body["overall"] == 2
    assert body["pronunciation"]["score"] == 2
    assert body["stress"]["comment_vi"].startswith("Trọng âm")
    assert body["fluency"]["score"] == 3
    assert [fix["word"] for fix in body["fixes"]] == ["barista"]
    assert body["fixes"][0]["ipa"] == "/bəˈrɪstə/"
    assert body["summary_vi"]
    assert body["remaining_today"] == get_settings().ai_speaking_daily_limit - 1

    # Lần 1 chỉ chép lời: model không được thấy câu mẫu; lần 2 mới có câu mẫu, từ và lời đã chép.
    transcribe, evaluate = fake_ai.prompts
    assert "barista" not in transcribe and "coffee" not in transcribe
    assert json.dumps(REFERENCE) in evaluate
    assert '"barista"' in evaluate
    assert "They be ready to make my coffee to go." in evaluate
    assert f"CEFR {auth['user']['level']}" in evaluate
    for clips in fake_ai.audio:
        assert [(c.data, c.mime_type) for c in clips] == [(AUDIO_BYTES, "audio/m4a")]


async def test_recording_is_never_stored(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
) -> None:
    await post(client, auth)

    [row] = await rows(test_engine)
    assert (row.kind, row.status, row.model, row.topic) == ("speaking", "ok", "fake-model", None)
    assert row.result["status"] == "ok"
    assert row.result["reference_text"] == REFERENCE
    stored = json.dumps(row.result) + repr(row.error)
    assert AUDIO not in stored
    assert "fake recording" not in stored


async def test_silent_recording_is_not_scored_or_counted(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
) -> None:
    fake_ai.json_by_schema["SpeakingTranscript"] = heard("  ")

    body = (await post(client, auth)).json()

    assert body["status"] == "no_speech"
    assert body["transcript"] == ""
    assert body["overall"] is None and body["pronunciation"] is None
    assert body["fixes"] == []
    assert "nghe rõ" in body["summary_vi"]
    assert body["remaining_today"] == get_settings().ai_speaking_daily_limit
    assert len(fake_ai.prompts) == 1  # không gọi lần chấm
    [row] = await rows(test_engine)
    assert row.result["status"] == "no_speech"


async def test_different_sentence_is_not_scored_or_counted(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi
) -> None:
    fake_ai.json_by_schema["SpeakingTranscript"] = heard(
        "I would like to book a table for two tonight."
    )

    body = (await post(client, auth)).json()

    assert body["status"] == "different_sentence"
    assert body["transcript"] == "I would like to book a table for two tonight."
    assert body["overall"] is None
    assert body["remaining_today"] == get_settings().ai_speaking_daily_limit
    assert len(fake_ai.prompts) == 1
    quota = (await client.get("/api/v1/ai/quota", headers=auth["headers"])).json()
    assert quota["speaking_remaining"] == get_settings().ai_speaking_daily_limit


async def test_quota_exceeded_is_429_and_separate_from_suggest(
    client: AsyncClient,
    auth: dict[str, Any],
    fake_ai: FakeAi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "ai_speaking_daily_limit", 1)
    assert (await post(client, auth)).status_code == 200

    response = await post(client, auth)

    assert response.status_code == 429
    error = response.json()["error"]
    assert error["code"] == "AI_QUOTA_EXCEEDED"
    tz = auth["user"]["timezone"]
    tomorrow = start_of_local_day(local_today(tz) + timedelta(days=1), tz)
    assert datetime.fromisoformat(error["details"]["resets_at"]) == tomorrow
    assert len(fake_ai.prompts) == 2  # lần bị chặn không gọi Gemini
    quota = (await client.get("/api/v1/ai/quota", headers=auth["headers"])).json()
    assert quota["speaking_remaining"] == 0
    assert quota["suggest_remaining"] == get_settings().ai_suggest_daily_limit


async def test_unclear_attempts_do_not_use_up_quota(
    client: AsyncClient,
    auth: dict[str, Any],
    fake_ai: FakeAi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "ai_speaking_daily_limit", 1)
    fake_ai.json_by_schema["SpeakingTranscript"] = heard("")
    for _ in range(3):
        assert (await post(client, auth)).json()["status"] == "no_speech"

    fake_ai.json_by_schema["SpeakingTranscript"] = heard(REFERENCE)
    response = await post(client, auth)

    assert response.status_code == 200
    assert response.json()["remaining_today"] == 0


async def test_gemini_failure_is_502_and_not_counted(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, test_engine: AsyncEngine
) -> None:
    fake_ai.fail = True

    response = await post(client, auth)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_UPSTREAM_ERROR"
    [row] = await rows(test_engine)
    assert (row.kind, row.status, row.result) == ("speaking", "error", None)
    quota = (await client.get("/api/v1/ai/quota", headers=auth["headers"])).json()
    assert quota["speaking_remaining"] == get_settings().ai_speaking_daily_limit


async def test_overall_deadline_is_502(
    client: AsyncClient,
    auth: dict[str, Any],
    fake_ai: FakeAi,
    monkeypatch: pytest.MonkeyPatch,
    test_engine: AsyncEngine,
) -> None:
    import asyncio

    original = fake_ai.generate

    async def slow(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(1)
        return await original(*args, **kwargs)

    monkeypatch.setattr(fake_ai, "generate", slow)
    monkeypatch.setattr(ai_service, "SPEAKING_DEADLINE_SECONDS", 0.05)

    response = await post(client, auth)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_UPSTREAM_ERROR"
    [row] = await rows(test_engine)
    assert row.status == "error"


@pytest.mark.parametrize(
    "body",
    [
        {"audio_base64": "không phải base64!!"},
        {"audio_base64": ""},
        {"audio_base64": "A" * 1_400_004},
        {"mime_type": "video/mp4"},
        {"reference_text": "   "},
        {"reference_text": "a" * 301},
        {"term": "a" * 101},
        {"level": "Z9"},
    ],
)
async def test_validation_errors(
    client: AsyncClient, auth: dict[str, Any], fake_ai: FakeAi, body: dict[str, Any]
) -> None:
    response = await post(client, auth, **body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert fake_ai.prompts == []


async def test_validation_error_does_not_echo_recording(
    client: AsyncClient, auth: dict[str, Any]
) -> None:
    response = await post(client, auth, audio_base64=AUDIO, mime_type="video/mp4")

    assert response.status_code == 422
    assert AUDIO not in response.text


async def test_requires_token(client: AsyncClient) -> None:
    response = await client.post(URL, json={"audio_base64": AUDIO, "reference_text": REFERENCE})

    assert response.status_code == 401
