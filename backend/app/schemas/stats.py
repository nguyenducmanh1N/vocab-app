import uuid
from datetime import date

from pydantic import BaseModel, Field


class TodayStats(BaseModel):
    cards_done: int
    goal: int
    goal_met: bool
    new_words: int
    correct: int


class LevelCounts(BaseModel):
    new: int
    learning: int
    familiar: int
    mastered: int


class ModeAccuracy(BaseModel):
    mode: str
    total: int
    correct: int


class OverviewOut(BaseModel):
    streak_current: int
    streak_best: int
    today: TodayStats
    levels: LevelCounts
    due_today: int  # due_at trước 00:00 ngày mai (giờ của user), gồm cả từ quá hạn
    accuracy_30d: list[ModeAccuracy]


class DailyParams(BaseModel):
    days: int = Field(default=30, ge=1, le=365)


class DailyStat(BaseModel):
    date: date
    cards_done: int
    correct: int
    new_words: int
    study_seconds: int


class HardWordsParams(BaseModel):
    limit: int = Field(default=10, ge=1, le=50)


class HardWord(BaseModel):
    word_id: uuid.UUID
    term: str
    meaning_vi: str
    wrong_count: int
    lapses: int
