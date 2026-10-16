import uuid

from pydantic import BaseModel, Field


class WordFeedParams(BaseModel):
    days: int = Field(default=7, ge=1, le=7)
    per_day: int = Field(default=3, ge=1, le=10)  # 7 × 10 = 70 mục tối đa (9.9)


class FeedItem(BaseModel):
    word_id: uuid.UUID
    term: str
    part_of_speech: str | None
    meaning_vi: str
    example_en: str | None
    example_vi: str | None


class WordFeedOut(BaseModel):
    items: list[FeedItem]
