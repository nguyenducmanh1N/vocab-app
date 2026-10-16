"""Gợi ý từ tiếng Anh khi đang gõ.

Dùng Datamuse (https://www.datamuse.com/api/): miễn phí, không cần key.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

SUGGEST_URL = "https://api.datamuse.com/sug"
TIMEOUT_SECONDS = 3.0  # gợi ý chỉ có ích khi nhanh; chậm thì bỏ qua


class SuggestClient:
    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        self._http = http or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def suggest(self, prefix: str, limit: int) -> list[str]:
        """Các từ hoặc cụm từ bắt đầu bằng `prefix`; lỗi gì cũng trả danh sách rỗng."""
        try:
            response = await self._http.get(
                SUGGEST_URL, params={"s": prefix, "max": limit}, timeout=TIMEOUT_SECONDS
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("datamuse %r: %r", prefix, exc)
            return []
        if not isinstance(data, list):
            return []
        return [
            item["word"]
            for item in data
            if isinstance(item, dict) and isinstance(item.get("word"), str) and item["word"]
        ]
