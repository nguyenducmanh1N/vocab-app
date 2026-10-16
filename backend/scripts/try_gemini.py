"""Gọi thử Gemini Interactions API để chốt dạng response_format (PLAN.md P2.1, ghi chú dưới 9.7).

Chạy: cd backend && uv run python scripts/try_gemini.py
Key lấy từ Settings (backend/.env); script không in key.
"""

import asyncio
import importlib.metadata
import inspect
import json
import sys
import time
from pathlib import Path
from typing import Any

from google import genai
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402

TIMEOUT_SECONDS = 30
PROMPT = (
    "Return exactly 2 English words about the topic 'coffee shop', "
    "each with a short Vietnamese meaning."
)


class Word(BaseModel):
    term: str
    meaning_vi: str


class TwoWords(BaseModel):
    words: list[Word]


def response_formats() -> dict[str, Any]:
    schema = TwoWords.model_json_schema()
    text_format = {"type": "text", "mime_type": "application/json", "schema": schema}
    return {
        "1. dict (code mẫu 9.7)": text_format,
        "2. list bọc dict (trang Migrating)": [text_format],
        "3. JSON schema trực tiếp (docs Cloud)": schema,
    }


async def try_once(client: genai.Client, model: str, label: str, fmt: Any) -> bool:
    started = time.monotonic()
    try:
        interaction = await asyncio.wait_for(
            client.aio.interactions.create(model=model, input=PROMPT, response_format=fmt),
            timeout=TIMEOUT_SECONDS,
        )
        result = TwoWords.model_validate_json(interaction.output_text or "")
    except Exception as exc:  # in mọi lỗi để so sánh các dạng
        elapsed = time.monotonic() - started
        print(f"  {label}: LỖI sau {elapsed:.1f}s — {type(exc).__name__}: {str(exc)[:200]}")
        return False
    elapsed = time.monotonic() - started
    words = ", ".join(f"{w.term} = {w.meaning_vi}" for w in result.words)
    print(f"  {label}: OK {elapsed:.1f}s — {words}")
    return True


async def main() -> None:
    settings = get_settings()
    print("google-genai:", importlib.metadata.version("google-genai"))
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY chưa đặt trong backend/.env")
        return
    client = genai.Client(api_key=settings.gemini_api_key)
    print(
        "client.aio.interactions.create là coroutine:",
        inspect.iscoroutinefunction(client.aio.interactions.create),
    )

    summary: dict[str, list[str]] = {}
    for model in (settings.gemini_model, settings.gemini_fallback_model):
        print(f"\n== {model}")
        for label, fmt in response_formats().items():
            ok = await try_once(client, model, label, fmt)
            summary.setdefault(label, []).append(f"{model}: {'OK' if ok else 'LỖI'}")

    print("\nTổng kết:")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
