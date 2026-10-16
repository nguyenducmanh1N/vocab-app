"""Mức thuộc tính từ word_progress (PLAN.md 7.4), không lưu trong DB."""

from datetime import datetime
from typing import Literal

from sqlalchemy import ColumnElement, and_

from app.models import WordProgress

Level = Literal["new", "learning", "familiar", "mastered"]

FAMILIAR_MIN_INTERVAL = 7
MASTERED_MIN_INTERVAL = 21


def level_of(due_at: datetime | None, interval_days: int) -> Level:
    if due_at is None:
        return "new"
    if interval_days < FAMILIAR_MIN_INTERVAL:
        return "learning"
    if interval_days < MASTERED_MIN_INTERVAL:
        return "familiar"
    return "mastered"


def level_condition(level: Level) -> ColumnElement[bool]:
    """Điều kiện SQL tương ứng level_of, dùng cho bộ lọc ?level=."""
    learned = WordProgress.due_at.is_not(None)
    interval = WordProgress.interval_days
    match level:
        case "new":
            return WordProgress.due_at.is_(None)
        case "learning":
            return and_(learned, interval < FAMILIAR_MIN_INTERVAL)
        case "familiar":
            return and_(
                learned, interval >= FAMILIAR_MIN_INTERVAL, interval < MASTERED_MIN_INTERVAL
            )
        case "mastered":
            return and_(learned, interval >= MASTERED_MIN_INTERVAL)
