"""GET /dictionary/{term} và cache (PLAN.md 9.6).

HTTP ra ngoài giả lập bằng respx, không gọi mạng.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.clients.dictionary import BASE_URL, DictionaryClient
from app.models import DictionaryCache
from app.services import dictionary_service
from tests.conftest import FakeClock

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / f"dictionary_{name}.json").read_text())


def entry_url(term: str) -> str:
    return BASE_URL + term


@pytest.fixture
async def session(test_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(test_engine, expire_on_commit=False) as s:
        yield s


@pytest.fixture
async def dictionary() -> AsyncIterator[DictionaryClient]:
    client = DictionaryClient()
    yield client
    await client.aclose()


async def cache_rows(engine: AsyncEngine) -> int:
    async with AsyncSession(engine) as s:
        return await s.scalar(select(func.count()).select_from(DictionaryCache)) or 0


# --- Qua API ---------------------------------------------------------------------------------


async def test_lookup_found_then_served_from_cache(
    client: AsyncClient,
    auth: dict[str, Any],
    respx_mock: respx.MockRouter,
    test_engine: AsyncEngine,
):
    route = respx_mock.get(entry_url("ubiquitous")).respond(200, json=fixture("ubiquitous"))

    first = await client.get("/api/v1/dictionary/ Ubiquitous ", headers=auth["headers"])
    second = await client.get("/api/v1/dictionary/ubiquitous", headers=auth["headers"])

    assert first.status_code == second.status_code == 200
    assert (
        first.json()
        == second.json()
        == {
            "term": "ubiquitous",
            "found": True,
            "ipa": "/juːˈbɪk.wə.təs/",
            "audio_url": "https://api.dictionaryapi.dev/media/pronunciations/en/ubiquitous-us.mp3",
            "part_of_speech": "adjective",
            "definitions_en": [
                "Being everywhere at once: omnipresent.",
                "Appearing to be everywhere at once; being or seeming to be in more than one "
                "location at the same time.",
                "Widespread; very prevalent.",
            ],
            "available": True,
        }
    )
    assert route.call_count == 1  # lần thứ hai lấy từ cache
    assert await cache_rows(test_engine) == 1


async def test_lookup_404_is_not_found(
    client: AsyncClient, auth: dict[str, Any], respx_mock: respx.MockRouter
):
    route = respx_mock.get(entry_url("qwxzyvbnmk")).respond(404, json=fixture("not_found"))

    first = await client.get("/api/v1/dictionary/qwxzyvbnmk", headers=auth["headers"])
    second = await client.get("/api/v1/dictionary/qwxzyvbnmk", headers=auth["headers"])

    assert first.status_code == 200
    assert first.json() == {
        "term": "qwxzyvbnmk",
        "found": False,
        "ipa": None,
        "audio_url": None,
        "part_of_speech": None,
        "definitions_en": [],
    }
    assert second.json()["found"] is False
    assert route.call_count == 1  # found=false cũng được cache


async def test_upstream_down_returns_not_found_without_caching(
    client: AsyncClient,
    auth: dict[str, Any],
    respx_mock: respx.MockRouter,
    test_engine: AsyncEngine,
):
    route = respx_mock.get(entry_url("deadline")).respond(522, text="error code: 522")

    response = await client.get("/api/v1/dictionary/deadline", headers=auth["headers"])

    assert response.status_code == 200
    assert response.json()["found"] is False
    assert response.json()["available"] is False  # từ điển lỗi, không phải "không có từ"
    assert route.call_count == 2  # thử lại 1 lần
    assert await cache_rows(test_engine) == 0  # không cache để lần sau tra lại


async def test_requires_token(client: AsyncClient):
    assert (await client.get("/api/v1/dictionary/deadline")).status_code == 401


# --- Service: thử lại, chuẩn hoá -------------------------------------------------------------


async def test_retries_once_after_5xx(
    session: AsyncSession, dictionary: DictionaryClient, respx_mock: respx.MockRouter
):
    route = respx_mock.get(entry_url("deadline"))
    route.side_effect = [httpx.Response(503), httpx.Response(200, json=fixture("deadline"))]

    out = await dictionary_service.lookup(session, dictionary, "deadline")

    assert out.found is True and out.ipa == "/ˈdɛdˌlaɪn/"
    assert route.call_count == 2


async def test_retries_once_after_network_error(
    session: AsyncSession, dictionary: DictionaryClient, respx_mock: respx.MockRouter
):
    route = respx_mock.get(entry_url("deadline"))
    route.side_effect = [
        httpx.ConnectTimeout("timeout"),
        httpx.Response(200, json=fixture("deadline")),
    ]

    out = await dictionary_service.lookup(session, dictionary, "deadline")

    assert out.found is True
    assert route.call_count == 2


@pytest.mark.parametrize(
    "response",
    [httpx.Response(200, text="<html>not json</html>"), httpx.Response(200, json={"a": 1})],
)
async def test_unexpected_payload_is_not_found(
    session: AsyncSession,
    dictionary: DictionaryClient,
    respx_mock: respx.MockRouter,
    response: httpx.Response,
):
    respx_mock.get(entry_url("deadline")).mock(return_value=response)

    out = await dictionary_service.lookup(session, dictionary, "deadline")

    assert out.found is False


async def test_more_than_three_words_skips_lookup(
    session: AsyncSession, dictionary: DictionaryClient, respx_mock: respx.MockRouter
):
    out = await dictionary_service.lookup(session, dictionary, "a b c d")

    assert out.found is False
    assert not respx_mock.calls


async def test_phrase_is_url_encoded(
    session: AsyncSession, dictionary: DictionaryClient, respx_mock: respx.MockRouter
):
    route = respx_mock.get(entry_url("look%20up")).respond(404, json=fixture("not_found"))

    out = await dictionary_service.lookup(session, dictionary, "  Look   UP ")

    assert out.term == "look up"
    assert route.call_count == 1


# --- Hạn cache (đồng hồ giả) -----------------------------------------------------------------


async def test_not_found_cache_expires_after_7_days(
    session: AsyncSession,
    dictionary: DictionaryClient,
    respx_mock: respx.MockRouter,
    clock: FakeClock,
):
    route = respx_mock.get(entry_url("qwxzyvbnmk")).respond(404, json=fixture("not_found"))
    await dictionary_service.lookup(session, dictionary, "qwxzyvbnmk")

    clock.advance(days=7, seconds=-1)
    await dictionary_service.lookup(session, dictionary, "qwxzyvbnmk")
    assert route.call_count == 1

    clock.advance(seconds=1)
    await dictionary_service.lookup(session, dictionary, "qwxzyvbnmk")
    assert route.call_count == 2


async def test_found_cache_kept_30_days(
    session: AsyncSession,
    dictionary: DictionaryClient,
    respx_mock: respx.MockRouter,
    clock: FakeClock,
):
    route = respx_mock.get(entry_url("deadline")).respond(200, json=fixture("deadline"))
    await dictionary_service.lookup(session, dictionary, "deadline")

    clock.advance(days=29)
    assert (await dictionary_service.lookup(session, dictionary, "deadline")).found is True
    assert route.call_count == 1

    clock.advance(days=1)
    await dictionary_service.lookup(session, dictionary, "deadline")
    assert route.call_count == 2


# --- Tra nhiều từ ----------------------------------------------------------------------------


class SlowFakeClient:
    """Đếm số lời gọi chạy cùng lúc để kiểm tra Semaphore(5)."""

    def __init__(self) -> None:
        self.running = 0
        self.max_running = 0
        self.calls: list[str] = []

    async def lookup(self, term: str) -> list[dict[str, Any]] | None:
        self.calls.append(term)
        self.running += 1
        self.max_running = max(self.max_running, self.running)
        await asyncio.sleep(0.01)
        self.running -= 1
        return None if term.startswith("missing") else [{"word": term, "phonetic": "/x/"}]


async def test_lookup_many_limits_concurrency_and_uses_cache(session: AsyncSession):
    fake = SlowFakeClient()
    terms = [f"word{i}" for i in range(10)] + ["missing1", "Word0"]  # "Word0" trùng "word0"

    results = await dictionary_service.lookup_many(session, fake, terms)  # type: ignore[arg-type]

    assert fake.max_running == 5
    assert len(fake.calls) == 11
    assert results["word3"].found is True and results["word3"].ipa == "/x/"
    assert results["missing1"].found is False

    again = await dictionary_service.lookup_many(session, fake, ["word3", "word11"])  # type: ignore[arg-type]
    assert fake.calls[11:] == ["word11"]  # word3 lấy từ cache
    assert again["word3"].found is True


# --- Cầu dao: từ điển lỗi thì tạm bỏ qua 60 giây ---------------------------------------------


async def test_cooldown_skips_http_after_failure(
    session: AsyncSession, respx_mock: respx.MockRouter
):
    now = [1000.0]
    client = DictionaryClient(clock=lambda: now[0])
    route = respx_mock.get(entry_url("deadline"))
    route.side_effect = [
        httpx.Response(503),
        httpx.Response(503),
        httpx.Response(200, json=fixture("deadline")),
    ]

    first = await dictionary_service.lookup(session, client, "deadline")
    assert first.found is False and route.call_count == 2

    # Trong 60 giây: không gọi HTTP, trả ngay found=false
    now[0] += 59
    assert (await dictionary_service.lookup(session, client, "deadline")).found is False
    assert route.call_count == 2

    # Hết 60 giây: tra lại bình thường
    now[0] += 2
    assert (await dictionary_service.lookup(session, client, "deadline")).found is True
    assert route.call_count == 3
    await client.aclose()


async def test_html_404_is_outage_not_missing_word(
    session: AsyncSession,
    dictionary: DictionaryClient,
    respx_mock: respx.MockRouter,
    test_engine: AsyncEngine,
):
    # Response thật của API cho "population" lúc máy chủ trục trặc: 404 kèm trang HTML.
    html = (FIXTURES / "dictionary_html_404.html").read_text(encoding="latin-1")
    route = respx_mock.get(entry_url("population")).respond(
        404, text=html, headers={"content-type": "text/html;charset=ISO-8859-1"}
    )

    out = await dictionary_service.lookup(session, dictionary, "population")

    assert out.found is False
    assert route.call_count == 2  # coi như lỗi máy chủ nên thử lại 1 lần
    assert await cache_rows(test_engine) == 0  # không lưu "không có từ" sai 7 ngày
