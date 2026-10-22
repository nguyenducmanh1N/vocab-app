"""Client Gemini (Interactions API + structured output), theo PLAN.md 9.7."""

import asyncio
import base64
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from google import genai
from pydantic import BaseModel, Field, ValidationError

from app.core.errors import AppError

logger = logging.getLogger(__name__)

# Mỗi model tối đa 20 giây: model chính treo thì model dự phòng vẫn kịp trả trước khi app
# (chờ 45 giây) bỏ cuộc. Thường mất 5–12 giây.
TIMEOUT_SECONDS = 20


class Example(BaseModel):
    en: str
    vi: str


class GeneratedWord(BaseModel):
    term: str = Field(description="English word or phrase, lowercase")
    part_of_speech: str = Field(description="noun, verb, adjective, adverb, phrase or idiom")
    ipa: str = Field(description="American English IPA, e.g. /streŋθ/")
    meaning_vi: str
    synonyms: list[str] = Field(max_length=5)  # = giới hạn synonyms của WordCreate (8.2)
    examples: list[Example] = Field(min_length=1, max_length=2)


class SuggestResult(BaseModel):
    words: list[GeneratedWord]


class EnrichResult(BaseModel):
    words: list[GeneratedWord]
    unknown_terms: list[str]


class InsightFamilyItem(BaseModel):
    term: str = Field(description="Another form from the same root, lowercase")
    part_of_speech: str
    meaning_vi: str
    example_en: str = Field(description="One example (max 12 words) that uses this exact form")


class InsightCollocation(BaseModel):
    phrase: str = Field(description="Collocation or fixed phrase that contains the term")
    meaning_vi: str
    example_en: str = Field(description="One example (max 12 words) that contains the phrase")


class InsightConfusable(BaseModel):
    term: str = Field(description="English word often confused with the item's term")
    difference_vi: str = Field(description="One Vietnamese sentence explaining the difference")
    example_en: str = Field(description="One example with the item's term")
    other_example_en: str = Field(description="One example with the confusable word")


class InsightItem(BaseModel):
    """Kết quả /ai/insights cho một từ; chỉ các phần được yêu cầu mới có dữ liệu (PLAN.md 9.12)."""

    id: str = Field(description="The id of the input item, unchanged")
    word_family: list[InsightFamilyItem] = Field(default_factory=list, max_length=5)
    collocations: list[InsightCollocation] = Field(default_factory=list, max_length=5)
    mnemonic_vi: str | None = Field(default=None, description="Vietnamese memory aid, max 30 words")
    confusables: list[InsightConfusable] = Field(default_factory=list, max_length=2)


class InsightResult(BaseModel):
    items: list[InsightItem]


class SpeakingTranscript(BaseModel):
    """Lần gọi 1 của nhận xét luyện nói: chỉ chép lời, model không thấy câu mẫu (PLAN.md 9.11)."""

    transcript: str = Field(
        description="Exactly what is spoken, or an empty string if there is no clear speech"
    )


class SpeakingCriterion(BaseModel):
    score: int = Field(ge=1, le=5)
    comment_vi: str


class SpeakingFix(BaseModel):
    word: str
    ipa: str = Field(description="American English IPA, e.g. /bəˈrɪstə/")
    issue_vi: str
    tip_vi: str


class SpeakingEvaluation(BaseModel):
    overall: int = Field(ge=1, le=5)
    pronunciation: SpeakingCriterion
    stress: SpeakingCriterion
    fluency: SpeakingCriterion
    fixes: list[SpeakingFix] = Field(max_length=3)
    summary_vi: str


def upstream_error(message: str = "Gemini không trả kết quả hợp lệ") -> AppError:
    return AppError(502, "AI_UPSTREAM_ERROR", message)


@dataclass(frozen=True)
class ImageInput:
    """Ảnh gửi kèm prompt (vd. ảnh chụp trang sách để lọc từ)."""

    data: bytes
    mime_type: str  # image/jpeg, image/png…


@dataclass(frozen=True)
class AudioInput:
    """Bản ghi gửi kèm prompt (luyện nói); chỉ nằm trong bộ nhớ, không ghi ra đĩa."""

    data: bytes
    mime_type: str  # audio/m4a…


class AiClient(Protocol):
    """Giao diện dùng chung cho GeminiClient và bản giả trong test."""

    async def generate[T: BaseModel](
        self,
        prompt: str,
        schema: type[T],
        images: Sequence[ImageInput] = (),
        audio: Sequence[AudioInput] = (),
    ) -> tuple[T, str]: ...


class GeminiClient:
    def __init__(self, api_key: str, model: str, fallback_model: str) -> None:
        self._client = genai.Client(api_key=api_key)
        self._models = [model, fallback_model]

    async def _generate[T: BaseModel](
        self,
        prompt: str,
        schema: type[T],
        model: str,
        images: Sequence[ImageInput] = (),
        audio: Sequence[AudioInput] = (),
    ) -> T:
        content: Any = prompt
        if images or audio:
            content = [
                # Audio đặt trước lời dặn: thử thật thấy model bám vào audio tốt hơn (mục 15).
                *(
                    {
                        "type": "audio",
                        "data": base64.b64encode(clip.data).decode(),
                        "mime_type": clip.mime_type,
                    }
                    for clip in audio
                ),
                {"type": "text", "text": prompt},
                *(
                    {
                        "type": "image",
                        "data": base64.b64encode(img.data).decode(),
                        "mime_type": img.mime_type,
                    }
                    for img in images
                ),
            ]
        interaction = await self._client.aio.interactions.create(
            model=model,
            input=content,
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": schema.model_json_schema(),
            },
        )
        text = getattr(interaction, "output_text", None)
        if not text:
            raise ValueError("Gemini trả về rỗng")
        return schema.model_validate_json(text)

    async def generate[T: BaseModel](
        self,
        prompt: str,
        schema: type[T],
        images: Sequence[ImageInput] = (),
        audio: Sequence[AudioInput] = (),
    ) -> tuple[T, str]:
        """Thử model chính rồi model dự phòng; trả (kết quả, tên model đã dùng)."""
        last_error: Exception | None = None
        for model in self._models:
            try:
                result = await asyncio.wait_for(
                    self._generate(prompt, schema, model, images, audio), timeout=TIMEOUT_SECONDS
                )
                return result, model
            except (TimeoutError, ValidationError, ValueError) as exc:
                last_error = exc
                logger.warning("gemini %s: kết quả không dùng được: %r", model, exc)
            except Exception as exc:  # lỗi SDK (429, 5xx, mạng…): chuyển sang model dự phòng
                last_error = exc
                logger.warning("gemini %s: lỗi gọi API: %r", model, exc)
        raise upstream_error() from last_error


class MissingKeyClient:
    """Dùng khi chưa đặt GEMINI_API_KEY: mọi lời gọi trả 502 kèm hướng dẫn rõ ràng."""

    async def generate[T: BaseModel](
        self,
        prompt: str,
        schema: type[T],
        images: Sequence[ImageInput] = (),
        audio: Sequence[AudioInput] = (),
    ) -> tuple[T, str]:
        raise upstream_error("Chưa cấu hình GEMINI_API_KEY trên máy chủ")
