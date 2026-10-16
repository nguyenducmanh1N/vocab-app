"""GeminiClient: chuyển sang model dự phòng và trả AI_UPSTREAM_ERROR (PLAN.md 9.7, P2.1).

Không gọi API thật: thay GeminiClient._generate bằng hàm giả.
"""

import asyncio
import json
from typing import Any

import pytest
from pydantic import BaseModel

from app.clients import gemini
from app.clients.gemini import (
    AudioInput,
    EnrichResult,
    GeminiClient,
    ImageInput,
    SpeakingEvaluation,
    SpeakingTranscript,
    SuggestResult,
)
from app.core.errors import AppError
from tests.conftest import FIXTURES_DIR, FakeAi

VALID = {"words": [], "unknown_terms": ["x"]}


def make_client(monkeypatch: pytest.MonkeyPatch, behaviour: dict[str, Any]) -> list[str]:
    """behaviour: model -> Exception để ném, hoặc chuỗi JSON để trả. Trả danh sách model đã gọi."""
    calls: list[str] = []

    async def fake_generate(
        self: GeminiClient,
        prompt: str,
        schema: type[BaseModel],
        model: str,
        images: Any = (),
        audio: Any = (),
    ):
        calls.append(model)
        outcome = behaviour[model]
        if isinstance(outcome, Exception):
            raise outcome
        if outcome == "slow":
            await asyncio.sleep(1)
        return schema.model_validate_json(outcome)

    monkeypatch.setattr(GeminiClient, "_generate", fake_generate)
    return calls


async def test_uses_primary_model_when_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = make_client(monkeypatch, {"main": json.dumps(VALID), "backup": json.dumps(VALID)})

    result, model = await GeminiClient("k", "main", "backup").generate("p", EnrichResult)

    assert model == "main" and calls == ["main"]
    assert result.unknown_terms == ["x"]


@pytest.mark.parametrize(
    "primary_failure",
    [RuntimeError("429 RESOURCE_EXHAUSTED"), '{"words": "not a list"}', "not json", "slow"],
)
async def test_falls_back_when_primary_fails(
    monkeypatch: pytest.MonkeyPatch, primary_failure: Any
) -> None:
    monkeypatch.setattr(gemini, "TIMEOUT_SECONDS", 0.05)
    calls = make_client(monkeypatch, {"main": primary_failure, "backup": json.dumps(VALID)})

    _, model = await GeminiClient("k", "main", "backup").generate("p", EnrichResult)

    assert model == "backup"
    assert calls == ["main", "backup"]


async def test_both_models_fail_is_upstream_error(monkeypatch: pytest.MonkeyPatch) -> None:
    make_client(monkeypatch, {"main": RuntimeError("500"), "backup": '{"wrong": "schema"}'})

    with pytest.raises(AppError) as exc_info:
        await GeminiClient("k", "main", "backup").generate("p", EnrichResult)

    assert exc_info.value.status == 502
    assert exc_info.value.code == "AI_UPSTREAM_ERROR"


async def test_invalid_schema_on_both_models_is_upstream_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = make_client(
        monkeypatch,
        {"main": '{"words": [{"term": "x"}]}', "backup": '{"unexpected": true}'},
    )

    with pytest.raises(AppError) as exc_info:
        await GeminiClient("k", "main", "backup").generate("p", SuggestResult)

    assert (exc_info.value.status, exc_info.value.code) == (502, "AI_UPSTREAM_ERROR")
    assert calls == ["main", "backup"]


async def test_fake_ai_reads_suggest_fixture() -> None:
    fake = FakeAi()

    result, model = await fake.generate("prompt", SuggestResult)

    assert model == "fake-model"
    assert [w.term for w in result.words] == ["barista", "to go", "refill"]
    assert all(w.examples for w in result.words)
    assert fake.prompts == ["prompt"]


@pytest.mark.parametrize(
    ("name", "schema"),
    [
        ("gemini_suggest.json", SuggestResult),
        ("gemini_enrich.json", EnrichResult),
        ("gemini_speaking_transcript.json", SpeakingTranscript),
        ("gemini_speaking_evaluation.json", SpeakingEvaluation),
    ],
)
def test_gemini_fixtures_match_real_schema(name: str, schema: type[BaseModel]) -> None:
    schema.model_validate_json((FIXTURES_DIR / name).read_text())


class _RecordingInteractions:
    def __init__(self) -> None:
        self.kwargs: dict[str, Any] = {}

    async def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        return type("Interaction", (), {"output_text": '{"transcript": "hi"}'})()


def _client_with(monkeypatch: pytest.MonkeyPatch, interactions: _RecordingInteractions) -> Any:
    """GeminiClient với SDK giả ghi lại request; bỏ chặn của block_real_gemini để chạy _generate
    thật (không có mạng: _client đã bị thay)."""
    monkeypatch.undo()
    client = GeminiClient("k", "main", "backup")
    client._client = type("C", (), {"aio": type("A", (), {"interactions": interactions})()})()
    return client


async def test_audio_is_sent_inline_before_the_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    interactions = _RecordingInteractions()
    client = _client_with(monkeypatch, interactions)

    result, _ = await client.generate(
        "chép lời", SpeakingTranscript, audio=[AudioInput(b"\x00\x01", "audio/m4a")]
    )

    assert result.transcript == "hi"
    assert interactions.kwargs["input"] == [
        {"type": "audio", "data": "AAE=", "mime_type": "audio/m4a"},
        {"type": "text", "text": "chép lời"},
    ]


async def test_image_parts_keep_prompt_first(monkeypatch: pytest.MonkeyPatch) -> None:
    interactions = _RecordingInteractions()
    client = _client_with(monkeypatch, interactions)

    await client.generate("p", SpeakingTranscript, [ImageInput(b"\x00", "image/png")])

    assert interactions.kwargs["input"] == [
        {"type": "text", "text": "p"},
        {"type": "image", "data": "AA==", "mime_type": "image/png"},
    ]


def test_fake_ai_is_wired_through_dependency_overrides(app: Any, fake_ai: FakeAi) -> None:
    from app.api.v1.deps import get_ai_client

    assert app.dependency_overrides[get_ai_client]() is fake_ai


async def test_real_gemini_requests_are_blocked_in_tests() -> None:
    # Không thay _generate: SDK thật gửi request, fixture block_real_gemini phải chặn lại.
    with pytest.raises(AppError) as exc_info:
        await GeminiClient("fake-key", "m1", "m2").generate("p", SuggestResult)

    cause = exc_info.value.__cause__
    assert cause is not None and "Gemini thật" in repr(cause)
