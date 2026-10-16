from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.models import WordProgress
from app.services.srs import SrsState, due_at_after, level_of, sm2, state_of

HCM = "Asia/Ho_Chi_Minh"  # UTC+7


@pytest.mark.parametrize(
    ("before", "q", "after"),
    [
        ((2.50, 0, 0, 0), 4, (2.50, 1, 1, 0)),
        ((2.50, 1, 1, 0), 4, (2.50, 6, 2, 0)),
        ((2.50, 6, 2, 0), 4, (2.50, 15, 3, 0)),
        ((2.50, 6, 2, 0), 5, (2.60, 16, 3, 0)),
        ((2.50, 6, 2, 0), 3, (2.36, 14, 3, 0)),
        ((2.50, 15, 3, 0), 1, (1.96, 1, 0, 1)),
        ((1.30, 10, 4, 0), 3, (1.30, 13, 5, 0)),
    ],
)
def test_sm2_table(
    before: tuple[float, int, int, int], q: int, after: tuple[float, int, int, int]
) -> None:
    assert sm2(SrsState(*before), q) == SrsState(*after)


def test_default_state_is_new_word() -> None:
    assert SrsState() == SrsState(2.5, 0, 0, 0)


def test_state_of_reads_progress() -> None:
    progress = WordProgress(ease_factor=Decimal("2.36"), interval_days=14, repetitions=3, lapses=1)
    assert state_of(progress) == SrsState(2.36, 14, 3, 1)


@pytest.mark.parametrize(
    ("interval_days", "expected"),
    [(0, "learning"), (6, "learning"), (7, "familiar"), (20, "familiar"), (21, "mastered")],
)
def test_level_of_thresholds(interval_days: int, expected: str) -> None:
    progress = WordProgress(interval_days=interval_days, due_at=datetime(2026, 10, 15, tzinfo=UTC))
    assert level_of(progress) == expected


def test_level_of_new_when_never_reviewed() -> None:
    assert level_of(WordProgress(interval_days=0, due_at=None)) == "new"


@pytest.mark.parametrize(
    ("answered_at", "interval_days", "expected"),
    [
        # 23:59 ngày 15/10 giờ VN (16:59 UTC) → ngày local 15/10 → 00:00 16/10 VN = 17:00 UTC 15/10
        (datetime(2026, 10, 15, 16, 59, tzinfo=UTC), 1, datetime(2026, 10, 15, 17, 0, tzinfo=UTC)),
        # 00:01 ngày 16/10 giờ VN (17:01 UTC 15/10): vẫn 15/10 theo UTC nhưng đã sang 16/10 local
        (datetime(2026, 10, 15, 17, 1, tzinfo=UTC), 1, datetime(2026, 10, 16, 17, 0, tzinfo=UTC)),
        # 00:00 đúng nửa đêm VN tính là ngày mới
        (datetime(2026, 10, 15, 17, 0, tzinfo=UTC), 6, datetime(2026, 10, 21, 17, 0, tzinfo=UTC)),
        (datetime(2026, 10, 15, 16, 59, tzinfo=UTC), 15, datetime(2026, 10, 29, 17, 0, tzinfo=UTC)),
    ],
)
def test_due_at_near_midnight_ho_chi_minh(
    answered_at: datetime, interval_days: int, expected: datetime
) -> None:
    due = due_at_after(answered_at, interval_days, HCM)
    assert due == expected
    assert due.utcoffset() is not None and due.utcoffset().total_seconds() == 0


def test_due_at_differs_from_naive_utc_day() -> None:
    # Cùng ngày UTC (15/10) nhưng khác ngày local → hạn ôn khác nhau
    before_midnight = due_at_after(datetime(2026, 10, 15, 16, 59, tzinfo=UTC), 1, HCM)
    after_midnight = due_at_after(datetime(2026, 10, 15, 17, 1, tzinfo=UTC), 1, HCM)
    assert (after_midnight - before_midnight).days == 1
