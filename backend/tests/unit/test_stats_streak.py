from datetime import date, timedelta

from app.services.streak import STREAK_WINDOW_DAYS, compute_streaks

TODAY = date(2026, 10, 15)


def days_ago(*offsets: int) -> list[date]:
    return [TODAY - timedelta(days=n) for n in offsets]


def test_stats_streak_today_not_done_yet_keeps_streak_from_yesterday() -> None:
    assert compute_streaks(days_ago(1, 2, 3), TODAY) == (3, 3)


def test_stats_streak_counts_today_when_met() -> None:
    assert compute_streaks(days_ago(0, 1, 2), TODAY) == (3, 3)


def test_stats_streak_missing_one_day_resets_current() -> None:
    assert compute_streaks(days_ago(2, 3, 4), TODAY) == (0, 3)
    assert compute_streaks(days_ago(0, 2, 3), TODAY) == (1, 2)


def test_stats_streak_best_longer_in_the_past() -> None:
    past_run = days_ago(*range(20, 30))  # 10 ngày liên tiếp
    assert compute_streaks([*past_run, *days_ago(0, 1)], TODAY) == (2, 10)


def test_stats_streak_best_is_current_run() -> None:
    assert compute_streaks([*days_ago(*range(0, 6)), *days_ago(10, 11)], TODAY) == (6, 6)


def test_stats_streak_ignores_days_outside_400_day_window() -> None:
    old_run = days_ago(*range(STREAK_WINDOW_DAYS, STREAK_WINDOW_DAYS + 30))  # ngoài khung
    edge = days_ago(STREAK_WINDOW_DAYS - 1, STREAK_WINDOW_DAYS - 2)  # vừa trong khung
    assert compute_streaks([*old_run, *edge, *days_ago(0)], TODAY) == (1, 2)


def test_stats_streak_unsorted_and_duplicate_input() -> None:
    assert compute_streaks(days_ago(1, 0, 1, 2, 0, 5), TODAY) == (3, 3)


def test_stats_streak_future_days_ignored_and_empty() -> None:
    assert compute_streaks([TODAY + timedelta(days=1)], TODAY) == (0, 0)
    assert compute_streaks([], TODAY) == (0, 0)
