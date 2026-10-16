from datetime import UTC, datetime

import pytest

from app.core.levels import level_of

DUE = datetime(2026, 10, 14, tzinfo=UTC)


@pytest.mark.parametrize(
    ("due_at", "interval_days", "expected"),
    [
        (None, 0, "new"),
        (None, 30, "new"),  # chưa học lần nào thì vẫn là từ mới
        (DUE, 0, "learning"),
        (DUE, 6, "learning"),
        (DUE, 7, "familiar"),
        (DUE, 20, "familiar"),
        (DUE, 21, "mastered"),
        (DUE, 120, "mastered"),
    ],
)
def test_level_of(due_at: datetime | None, interval_days: int, expected: str) -> None:
    assert level_of(due_at, interval_days) == expected
