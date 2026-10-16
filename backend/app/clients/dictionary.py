"""Client cho Free Dictionary API (PLAN.md 9.6). API cộng đồng, không cam kết uptime."""

import logging
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/"
TIMEOUT_SECONDS = 5.0
MAX_ATTEMPTS = 2  # thử lại 1 lần khi lỗi mạng hoặc 5xx
# Sau khi từ điển lỗi, bỏ qua từ điển trong khoảng này để request khác không phải chờ timeout.
COOLDOWN_SECONDS = 60.0


def _is_not_found_body(response: httpx.Response) -> bool:
    try:
        body = response.json()
    except ValueError:
        return False
    return isinstance(body, dict) and "title" in body


class DictionaryUnavailable(Exception):
    """Từ điển lỗi (mạng, 5xx, dữ liệu lạ). Service coi như không tìm thấy, không cache."""


class DictionaryClient:
    def __init__(
        self, http: httpx.AsyncClient | None = None, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._http = http or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
        self._clock = clock
        self._down_until = 0.0

    def reset(self) -> None:
        """Đóng lại cầu dao (dùng trong test)."""
        self._down_until = 0.0

    async def aclose(self) -> None:
        await self._http.aclose()

    async def lookup(self, term: str) -> list[dict[str, Any]] | None:
        """Trả mảng entry; None nếu từ điển không có từ này (404)."""
        if self._clock() < self._down_until:
            raise DictionaryUnavailable("Từ điển vừa lỗi, tạm bỏ qua")
        try:
            data = await self._lookup(term)
        except DictionaryUnavailable:
            self._down_until = self._clock() + COOLDOWN_SECONDS
            raise
        self._down_until = 0.0
        return data

    async def _lookup(self, term: str) -> list[dict[str, Any]] | None:
        url = BASE_URL + quote(term, safe="")
        last_error: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = await self._http.get(url, timeout=TIMEOUT_SECONDS)
            except httpx.TransportError as exc:  # gồm cả timeout
                last_error = exc
                logger.warning("dictionary %r: lỗi mạng lần %d: %r", term, attempt, exc)
                continue
            if response.status_code == 404:
                # Không có từ: API trả JSON {"title": "No Definitions Found", ...}. Khi máy chủ
                # trục trặc, API lại trả trang HTML 404 cho cả từ có thật → coi là lỗi, không cache.
                if _is_not_found_body(response):
                    return None
                last_error = DictionaryUnavailable("HTTP 404 không phải JSON")
                logger.warning("dictionary %r: 404 dạng HTML lần %d", term, attempt)
                continue
            if response.status_code >= 500:
                last_error = DictionaryUnavailable(f"HTTP {response.status_code}")
                logger.warning("dictionary %r: HTTP %d lần %d", term, response.status_code, attempt)
                continue
            if response.status_code != 200:
                raise DictionaryUnavailable(f"HTTP {response.status_code}")
            try:
                data = response.json()
            except ValueError as exc:
                raise DictionaryUnavailable("Response không phải JSON") from exc
            if not isinstance(data, list):
                raise DictionaryUnavailable("Response không phải mảng entry")
            return data
        raise DictionaryUnavailable(str(last_error)) from last_error
