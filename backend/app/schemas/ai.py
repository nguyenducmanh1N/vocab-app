import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.schemas.user import Level
from app.schemas.word import Collocation, Confusable, Example, FamilyItem

EnrichTerm = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class EnrichIn(BaseModel):
    terms: list[EnrichTerm] = Field(min_length=1, max_length=30)
    level: Level | None = None  # mặc định lấy trình độ của user


class SuggestedWord(BaseModel):
    term: str
    part_of_speech: str | None
    ipa: str | None
    meaning_vi: str
    definition_en: str | None = None  # định nghĩa tiếng Anh từ từ điển, mỗi dòng một định nghĩa
    synonyms: list[str]
    examples: list[Example]
    audio_url: str | None
    already_saved: bool
    cloze_ready: bool
    corrected_from: str | None = None  # term người dùng gõ khi AI đã sửa chính tả


class EnrichOut(BaseModel):
    remaining_today: int
    words: list[SuggestedWord]
    unknown_terms: list[str]


WordType = Literal["word", "phrase", "idiom"]


def _dedupe(values: list[WordType]) -> list[WordType]:
    return list(dict.fromkeys(values))


class SuggestIn(BaseModel):
    topic: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    level: Level | None = None  # mặc định lấy trình độ của user
    count: Literal[10, 20, 30] = 20
    word_types: Annotated[list[WordType], Field(min_length=1), AfterValidator(_dedupe)] = [
        "word",
        "phrase",
    ]
    exclude_terms: list[EnrichTerm] = Field(default_factory=list, max_length=200)


class SuggestOut(BaseModel):
    generation_id: uuid.UUID
    cached: bool
    remaining_today: int
    words: list[SuggestedWord]


class HistoryItem(BaseModel):
    generation_id: uuid.UUID
    topic: str | None
    level: str | None
    word_count: int | None
    created_at: datetime


class QuotaOut(BaseModel):
    suggest_remaining: int
    enrich_remaining: int
    speaking_remaining: int
    resets_at: datetime  # đầu ngày mai theo múi giờ của user


class ExtractIn(BaseModel):
    """Ảnh (base64) để AI lọc ra các từ đáng học, ví dụ ảnh chụp trang sách."""

    image_base64: str = Field(min_length=1, max_length=7_000_000)  # ~5 MB ảnh
    mime_type: Literal["image/jpeg", "image/png", "image/webp", "image/heic"] = "image/jpeg"
    level: Level | None = None
    count: Annotated[int, Field(ge=5, le=30)] = 20


InsightPart = Literal["family", "collocations", "mnemonic", "confusables"]


def _dedupe_parts(values: list[InsightPart]) -> list[InsightPart]:
    return list(dict.fromkeys(values))


class InsightsIn(BaseModel):
    """Bổ sung họ từ, cụm đi kèm, mẹo nhớ, từ hay nhầm cho một lô từ (PLAN.md 9.12)."""

    word_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    parts: Annotated[list[InsightPart], Field(min_length=1), AfterValidator(_dedupe_parts)]
    overwrite: bool = False


class InsightWordOut(BaseModel):
    """Giá trị đã lưu của các phần được yêu cầu; phần không yêu cầu để null."""

    word_id: uuid.UUID
    mnemonic: str | None = None
    word_family: list[FamilyItem] | None = None
    collocations: list[Collocation] | None = None
    confusables: list[Confusable] | None = None


class InsightsOut(BaseModel):
    remaining_today: int
    words: list[InsightWordOut]


class SpeakingFeedbackIn(BaseModel):
    """Bản ghi luyện nói (base64) và câu mẫu; server không ghi bản ghi ra đĩa (PLAN.md 9.11)."""

    audio_base64: str = Field(min_length=1, max_length=1_400_000)  # ~1 MB, app cắt ở 20 giây
    mime_type: Literal["audio/m4a", "audio/aac", "audio/mp4", "audio/wav", "audio/mpeg"] = (
        "audio/m4a"
    )
    reference_text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)
    ]
    term: Annotated[
        str | None, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ] = None
    level: Level | None = None


class SpeakingCriterionOut(BaseModel):
    score: int  # 1–5
    comment_vi: str


class SpeakingFixOut(BaseModel):
    word: str
    ipa: str
    issue_vi: str
    tip_vi: str


class SpeakingFeedbackOut(BaseModel):
    remaining_today: int
    # ok: có chấm; no_speech: không nghe rõ tiếng nói; different_sentence: đọc câu khác câu mẫu.
    # Hai trường hợp sau không tính lượt, điểm và nhận xét là null.
    status: Literal["ok", "no_speech", "different_sentence"]
    transcript: str  # AI nghe được gì (chép lời khi chưa cho model thấy câu mẫu)
    overall: int | None
    pronunciation: SpeakingCriterionOut | None
    stress: SpeakingCriterionOut | None
    fluency: SpeakingCriterionOut | None
    fixes: list[SpeakingFixOut]
    summary_vi: str
