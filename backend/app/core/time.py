from collections.abc import Callable
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo


def _system_now() -> datetime:
    return datetime.now(UTC)


# Test thay hàm này (fixture `clock` trong tests/conftest.py) để giả đồng hồ.
_now_provider: Callable[[], datetime] = _system_now


def now_utc() -> datetime:
    """Thời điểm hiện tại (UTC). Mọi code gọi hàm này thay cho datetime.now() để test giả được."""
    return _now_provider()


def local_today(tz: str) -> date:
    """Ngày hôm nay theo múi giờ của người dùng (ví dụ "Asia/Ho_Chi_Minh")."""
    return now_utc().astimezone(ZoneInfo(tz)).date()


def start_of_local_day(day: date, tz: str) -> datetime:
    """00:00 của `day` theo múi giờ `tz`, đổi sang UTC."""
    return datetime.combine(day, time.min, tzinfo=ZoneInfo(tz)).astimezone(UTC)
