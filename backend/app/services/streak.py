"""Streak (PLAN.md 9.5). Hàm thuần để test không cần DB."""

from collections.abc import Iterable
from datetime import date, timedelta

STREAK_MIN_CARDS = 10  # một ngày được tính vào streak khi cards_done ≥ 10
STREAK_WINDOW_DAYS = 400  # streak_best tính trong 400 ngày gần nhất (kể cả hôm nay)


def compute_streaks(active_dates: Iterable[date], today: date) -> tuple[int, int]:
    """(streak_current, streak_best) từ các ngày đạt điều kiện.

    streak_current đếm lùi từ hôm nay; hôm nay chưa đạt thì bắt đầu từ hôm qua (streak chưa
    mất cho tới hết ngày). streak_best là chuỗi liên tiếp dài nhất trong 400 ngày gần nhất.
    """
    oldest = today - timedelta(days=STREAK_WINDOW_DAYS - 1)
    active = {day for day in active_dates if oldest <= day <= today}

    current = 0
    day = today if today in active else today - timedelta(days=1)
    while day in active:
        current += 1
        day -= timedelta(days=1)

    best = run = 0
    previous: date | None = None
    for day in sorted(active):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    return current, best
