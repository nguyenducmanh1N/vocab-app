import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from app.core.levels import Level
from app.schemas.word import WordOut

StudyMode = Literal[
    "review",
    "flashcard",
    "learn",
    "mcq",
    "typing",
    "dictation",
    "cloze",
    "speaking",
    "match",
    "test",
]

LIST_MAX_LIMIT = 50  # học theo list (9.3); Ôn tập hôm nay tối đa 100


class StudyQueueParams(BaseModel):
    list_id: uuid.UUID | None = None
    mode: StudyMode | None = None  # chưa ảnh hưởng cách chọn thẻ
    limit: int = Field(default=20, ge=1, le=100)
    starred_only: bool = False
    # Ôn tập hôm nay: học thêm từ mới ngoài hạn mức daily_new_words (học theo list không áp hạn mức)
    extra_new: int = Field(default=0, ge=0, le=20)

    @model_validator(mode="after")
    def _list_limit(self) -> Self:
        if self.list_id is not None and self.limit > LIST_MAX_LIMIT:
            raise ValueError(f"Học theo list: limit tối đa {LIST_MAX_LIMIT}")
        return self


class StudyCard(WordOut):
    is_new: bool
    is_due: bool


class DistractorOut(BaseModel):
    word_id: uuid.UUID
    term: str
    meaning_vi: str
    part_of_speech: str | None


class QueueStats(BaseModel):
    due_total: int
    new_available: int


class StudyQueueOut(BaseModel):
    cards: list[StudyCard]
    distractor_pool: list[DistractorOut]
    stats: QueueStats


# --- POST /study/sessions (PLAN.md 8.3, 9.4) ---------------------------------------------------

MAX_ANSWERS = 500


class AnswerIn(BaseModel):
    client_answer_id: uuid.UUID
    word_id: uuid.UUID
    quality: int = Field(ge=0, le=5)
    is_correct: bool
    is_first_attempt: bool  # server tự chốt lại (9.4 bước 3), không tin hẳn giá trị này
    response_ms: int | None = Field(default=None, ge=0)
    answered_at: AwareDatetime


class SessionIn(BaseModel):
    client_session_id: uuid.UUID
    list_id: uuid.UUID | None = None
    mode: StudyMode
    started_at: AwareDatetime
    finished: bool = False
    ended_at: AwareDatetime | None = None
    answers: list[AnswerIn] = Field(default_factory=list, max_length=MAX_ANSWERS)


class ProgressBrief(BaseModel):
    word_id: uuid.UUID
    level: Level
    due_at: datetime | None
    interval_days: int


class TodayOut(BaseModel):
    cards_done: int
    goal: int
    goal_met: bool
    streak_current: int


class SessionOut(BaseModel):
    session_id: uuid.UUID
    accepted: int
    duplicates: int
    progress: list[ProgressBrief]
    today: TodayOut
