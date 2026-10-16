"""GET /dictionary/suggest: gợi ý khi gõ ở ô Từ. Datamuse giả lập bằng respx, không gọi mạng."""

from typing import Any

import respx
from httpx import AsyncClient

from app.clients.datamuse import SUGGEST_URL

URL = "/api/v1/dictionary/suggest"


async def add_word(client: AsyncClient, auth: dict[str, Any], term: str) -> None:
    lists = (await client.get("/api/v1/lists", headers=auth["headers"])).json()
    list_id = (
        lists[0]["id"]
        if lists
        else (
            await client.post("/api/v1/lists", json={"name": "L"}, headers=auth["headers"])
        ).json()["id"]
    )
    response = await client.post(
        f"/api/v1/lists/{list_id}/words",
        json={"term": term, "meaning_vi": "nghĩa"},
        headers=auth["headers"],
    )
    assert response.status_code == 201, response.text


async def test_saved_words_first_then_english(
    client: AsyncClient, auth: dict[str, Any], respx_mock: respx.MockRouter
):
    await add_word(client, auth, "Deadline")
    route = respx_mock.get(SUGGEST_URL).respond(
        200,
        json=[
            {"word": "dead", "score": 1},
            {"word": "deadline", "score": 1},  # đã lưu → không lặp lại
            {"word": "deadlock", "score": 1},
        ],
    )

    response = await client.get(URL, params={"q": " DEAD "}, headers=auth["headers"])

    assert response.status_code == 200
    assert response.json() == [
        {"term": "deadline", "already_saved": True},
        {"term": "dead", "already_saved": False},
        {"term": "deadlock", "already_saved": False},
    ]
    assert route.calls.last.request.url.params["s"] == "dead"


async def test_english_suggestion_already_saved_is_flagged(
    client: AsyncClient, auth: dict[str, Any], respx_mock: respx.MockRouter
):
    await add_word(client, auth, "take off")
    respx_mock.get(SUGGEST_URL).respond(200, json=[{"word": "take on"}, {"word": "take off"}])

    body = (await client.get(URL, params={"q": "take o"}, headers=auth["headers"])).json()

    assert body == [
        {"term": "take off", "already_saved": True},
        {"term": "take on", "already_saved": False},
    ]


async def test_datamuse_down_still_returns_saved_words(
    client: AsyncClient, auth: dict[str, Any], respx_mock: respx.MockRouter
):
    await add_word(client, auth, "deadline")
    respx_mock.get(SUGGEST_URL).respond(522, text="error code: 522")

    response = await client.get(URL, params={"q": "dead"}, headers=auth["headers"])

    assert response.status_code == 200
    assert response.json() == [{"term": "deadline", "already_saved": True}]


async def test_limit_and_like_escape(
    client: AsyncClient, auth: dict[str, Any], respx_mock: respx.MockRouter
):
    await add_word(client, auth, "50% off")
    await add_word(client, auth, "500 words")
    respx_mock.get(SUGGEST_URL).respond(200, json=[{"word": f"w{i}"} for i in range(10)])

    escaped = (await client.get(URL, params={"q": "50%"}, headers=auth["headers"])).json()
    limited = (await client.get(URL, params={"q": "w", "limit": 3}, headers=auth["headers"])).json()

    assert [s["term"] for s in escaped][0] == "50% off"
    assert "500 words" not in [s["term"] for s in escaped]  # "%" không là ký tự đại diện
    assert len(limited) == 3


async def test_other_users_words_not_suggested(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    respx_mock: respx.MockRouter,
):
    await add_word(client, other_auth, "deadline")
    respx_mock.get(SUGGEST_URL).respond(200, json=[])

    body = (await client.get(URL, params={"q": "dead"}, headers=auth["headers"])).json()

    assert body == []


async def test_validation_and_auth(client: AsyncClient, auth: dict[str, Any]):
    assert (await client.get(URL, params={"q": " "}, headers=auth["headers"])).status_code == 422
    assert (
        await client.get(URL, params={"q": "a", "limit": 21}, headers=auth["headers"])
    ).status_code == 422
    assert (await client.get(URL, params={"q": "a"})).status_code == 401
