"""Ôn tập ngắt quãng SM-2 (PLAN.md 9.2) và mức thuộc (7.4). Hàm thuần, không đụng DB."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.levels import Level
from app.core.levels import level_of as _level_of
from app.core.time import start_of_local_day
from app.models import WordProgress


@dataclass(frozen=True)
class SrsState:
    ease_factor: float = 2.5
    interval_days: int = 0
    repetitions: int = 0
    lapses: int = 0


def sm2(state: SrsState, q: int) -> SrsState:
    """Cập nhật trạng thái theo SM-2 với điểm chất lượng q (0–5)."""
    ef = round(max(1.3, state.ease_factor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), 2)
    if q < 3:
        return SrsState(ef, 1, 0, state.lapses + 1)
    reps = state.repetitions + 1
    if reps == 1:
        interval = 1
    elif reps == 2:
        interval = 6
    else:
        interval = int(state.interval_days * ef + 0.5)
    return SrsState(ef, interval, reps, state.lapses)


def state_of(progress: WordProgress) -> SrsState:
    """Trạng thái SM-2 đang lưu của một từ (ease_factor trong DB là Decimal)."""
    return SrsState(
        ease_factor=float(progress.ease_factor),
        interval_days=progress.interval_days,
        repetitions=progress.repetitions,
        lapses=progress.lapses,
    )


def level_of(progress: WordProgress) -> Level:
    """Mức thuộc theo 7.4."""
    return _level_of(progress.due_at, progress.interval_days)


def due_at_after(answered_at: datetime, interval_days: int, tz: str) -> datetime:
    """Luật 4 ở 9.2: 00:00 của (ngày local lúc trả lời + interval) theo múi giờ user, trả UTC."""
    local_date = answered_at.astimezone(ZoneInfo(tz)).date()
    return start_of_local_day(local_date + timedelta(days=interval_days), tz)
