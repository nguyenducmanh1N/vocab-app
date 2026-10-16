import uuid
from datetime import timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import Word, WordProgress
from tests.conftest import FakeClock


async def new_list(client: AsyncClient, auth: dict[str, Any], name: str = "Công việc") -> str:
    response = await client.post("/api/v1/lists", json={"name": name}, headers=auth["headers"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def add(
    client: AsyncClient,
    auth: dict[str, Any],
    list_id: str,
    *,
    allow_duplicate: bool | None = None,
    **body: Any,
) -> Response:
    body.setdefault("meaning_vi", "nghĩa")
    params = {} if allow_duplicate is None else {"allow_duplicate": str(allow_duplicate).lower()}
    return await client.post(
        f"/api/v1/lists/{list_id}/words", json=body, params=params, headers=auth["headers"]
    )


async def added(client: AsyncClient, auth: dict[str, Any], list_id: str, **body: Any) -> dict:
    response = await add(client, auth, list_id, **body)
    assert response.status_code == 201, response.text
    return response.json()


def error(response: Response, status: int) -> dict[str, Any]:
    assert response.status_code == status, response.text
    return response.json()["error"]


async def count(engine: AsyncEngine, model: type) -> int:
    async with AsyncSession(engine) as session:
        return await session.scalar(select(func.count()).select_from(model)) or 0


async def set_progress(engine: AsyncEngine, word_id: str, **values: Any) -> None:
    async with AsyncSession(engine) as session:
        await session.execute(
            update(WordProgress).where(WordProgress.word_id == uuid.UUID(word_id)).values(**values)
        )
        await session.commit()


FAMILY = {
    "term": "decision",
    "part_of_speech": "noun",
    "meaning_vi": "quyết định",
    "example_en": "It was a hard decision.",
}
COLLOCATION = {
    "phrase": "make a decision",
    "meaning_vi": "đưa ra quyết định",
    "example_en": "We must make a decision today.",
}
CONFUSABLE = {
    "term": "determine",
    "difference_vi": "determine là xác định sau khi tìm hiểu, decide là chọn.",
    "example_en": "She decided to stay.",
    "other_example_en": "Tests determine the cause.",
}


# --- Thêm, xem, sửa, xoá ---------------------------------------------------------------------


async def test_create_word_with_progress(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
):
    list_id = await new_list(client, auth)

    word = await added(
        client,
        auth,
        list_id,
        term="  meet   the deadline ",
        meaning_vi="kịp hạn chót",
        part_of_speech="Phrase",
        ipa="/miːt ðə ˈdedlaɪn/",
        synonyms=["finish on time"],
        examples=[{"en": "We met the deadline.", "vi": "Chúng tôi đã kịp hạn."}],
        audio_url="https://example.com/a.mp3",
        is_starred=True,
    )

    assert word["term"] == "meet the deadline"
    assert word["part_of_speech"] == "phrase"
    assert word["examples"] == [
        {
            "en": "We met the deadline.",
            "vi": "Chúng tôi đã kịp hạn.",
            "source": None,
            "source_id": None,
            "source_url": None,
        }
    ]
    assert word["progress"] == {
        "level": "new",
        "due_at": None,
        "interval_days": 0,
        "repetitions": 0,
        "lapses": 0,
        "is_leech": False,
        "correct_count": 0,
        "wrong_count": 0,
        "last_reviewed_at": None,
    }
    assert await count(test_engine, WordProgress) == 1


async def test_get_update_delete(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
):
    list_id = await new_list(client, auth)
    word = await added(client, auth, list_id, term="deadline", note="ghi chú", ipa="/x/")
    url = f"/api/v1/words/{word['id']}"

    assert (await client.get(url, headers=auth["headers"])).json()["term"] == "deadline"

    patched = await client.patch(
        url,
        json={"meaning_vi": "hạn chót", "note": None, "ipa": None, "is_starred": True},
        headers=auth["headers"],
    )
    body = patched.json()
    assert patched.status_code == 200
    assert (body["meaning_vi"], body["note"], body["ipa"], body["is_starred"]) == (
        "hạn chót",
        None,
        None,
        True,
    )
    assert body["updated_at"] >= word["updated_at"]

    assert (await client.delete(url, headers=auth["headers"])).status_code == 204
    assert (await client.get(url, headers=auth["headers"])).status_code == 404
    assert await count(test_engine, WordProgress) == 0


@pytest.mark.parametrize(
    "body",
    [
        {"term": "", "meaning_vi": "x"},
        {"term": "x" * 101, "meaning_vi": "x"},
        {"term": "x", "meaning_vi": "x" * 501},
        {"term": "x", "meaning_vi": "x", "synonyms": ["a", "b", "c", "d", "e", "f"]},
        {"term": "x", "meaning_vi": "x", "examples": [{"en": "a"}] * 6},
        {"term": "x", "meaning_vi": "x", "examples": [{"en": "a", "source": "wiki"}]},
        {"term": "x", "meaning_vi": "x", "examples": [{"en": "a", "source_url": "ftp://x"}]},
        {"term": "x", "meaning_vi": "x", "mnemonic": "m" * 301},
        {"term": "x", "meaning_vi": "x", "word_family": [FAMILY] * 6},
        {"term": "x", "meaning_vi": "x", "word_family": [{**FAMILY, "khoa_la": 1}]},
        {"term": "x", "meaning_vi": "x", "word_family": [{"term": "decision"}]},
        {"term": "x", "meaning_vi": "x", "collocations": [COLLOCATION] * 6},
        {"term": "x", "meaning_vi": "x", "confusables": [CONFUSABLE] * 3},
        {"term": "x", "meaning_vi": "x", "audio_url": "ftp://x"},
        {"term": "x", "meaning_vi": "x", "khoa_la": 1},
    ],
)
async def test_create_validation_error(client: AsyncClient, auth: dict[str, Any], body: dict):
    list_id = await new_list(client, auth)

    response = await client.post(
        f"/api/v1/lists/{list_id}/words", json=body, headers=auth["headers"]
    )

    assert error(response, 422)["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("body", [{"term": None}, {"meaning_vi": None}, {"list_id": None}])
async def test_update_null_required_field_is_422(
    client: AsyncClient, auth: dict[str, Any], body: dict
):
    word = await added(client, auth, await new_list(client, auth), term="deadline")

    response = await client.patch(f"/api/v1/words/{word['id']}", json=body, headers=auth["headers"])

    assert response.status_code == 422


# --- Trùng -----------------------------------------------------------------------------------


async def test_duplicate_in_same_list_is_always_409(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    word = await added(client, auth, list_id, term="Deadline")

    for allow in (None, True):
        response = await add(client, auth, list_id, term=" DEADLINE ", allow_duplicate=allow)
        err = error(response, 409)
        assert err["code"] == "DUPLICATE_WORD"
        assert err["details"] == {"existing_word_id": word["id"]}


async def test_duplicate_in_other_list_is_409_with_details(
    client: AsyncClient, auth: dict[str, Any]
):
    work = await new_list(client, auth, "Công việc")
    travel = await new_list(client, auth, "Du lịch")
    word = await added(client, auth, work, term="deadline")

    err = error(await add(client, auth, travel, term="Deadline"), 409)

    assert err["code"] == "DUPLICATE_WORD"
    assert err["details"] == {
        "existing_word_id": word["id"],
        "list_id": work,
        "list_name": "Công việc",
    }


async def test_allow_duplicate_adds_to_other_list(client: AsyncClient, auth: dict[str, Any]):
    work = await new_list(client, auth, "Công việc")
    travel = await new_list(client, auth, "Du lịch")
    await added(client, auth, work, term="deadline")

    response = await add(client, auth, travel, term="deadline", allow_duplicate=True)

    assert response.status_code == 201
    assert response.json()["list_id"] == travel


async def test_same_term_of_other_user_is_not_duplicate(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
):
    await added(client, auth, await new_list(client, auth), term="deadline")

    response = await add(client, other_auth, await new_list(client, other_auth), term="deadline")

    assert response.status_code == 201


# --- Thêm hàng loạt --------------------------------------------------------------------------


async def test_bulk_skips_duplicates_in_list(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
):
    list_id = await new_list(client, auth)
    other_list = await new_list(client, auth, "Khác")
    await added(client, auth, list_id, term="deadline")
    await added(client, auth, other_list, term="meeting")

    response = await client.post(
        f"/api/v1/lists/{list_id}/words/bulk",
        json={
            "words": [
                {"term": "Deadline", "meaning_vi": "hạn chót"},  # đã có trong list
                {"term": "agenda", "meaning_vi": "chương trình họp"},
                {"term": "AGENDA", "meaning_vi": "lặp trong lô"},
                {"term": "meeting", "meaning_vi": "cuộc họp"},  # trùng list khác: vẫn thêm
            ]
        },
        headers=auth["headers"],
    )

    assert response.status_code == 201
    body = response.json()
    assert [w["term"] for w in body["created"]] == ["agenda", "meeting"]
    assert all(w["progress"]["level"] == "new" for w in body["created"])
    assert body["skipped"] == [
        {"term": "Deadline", "reason": "duplicate_in_list"},
        {"term": "AGENDA", "reason": "duplicate_in_list"},
    ]
    assert await count(test_engine, Word) == await count(test_engine, WordProgress) == 4


@pytest.mark.parametrize("size", [0, 101])
async def test_bulk_size_limits(client: AsyncClient, auth: dict[str, Any], size: int):
    list_id = await new_list(client, auth)
    words = [{"term": f"w{i}", "meaning_vi": "x"} for i in range(size)]

    response = await client.post(
        f"/api/v1/lists/{list_id}/words/bulk", json={"words": words}, headers=auth["headers"]
    )

    assert response.status_code == 422


async def test_bulk_100_words(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    words = [{"term": f"w{i}", "meaning_vi": "x"} for i in range(100)]

    response = await client.post(
        f"/api/v1/lists/{list_id}/words/bulk", json={"words": words}, headers=auth["headers"]
    )

    assert response.status_code == 201
    assert len(response.json()["created"]) == 100


# --- Chuyển list -----------------------------------------------------------------------------


async def test_move_word_keeps_progress(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
):
    work = await new_list(client, auth, "Công việc")
    travel = await new_list(client, auth, "Du lịch")
    word = await added(client, auth, work, term="deadline")
    await set_progress(test_engine, word["id"], interval_days=10, due_at=clock.current)

    response = await client.patch(
        f"/api/v1/words/{word['id']}", json={"list_id": travel}, headers=auth["headers"]
    )

    assert response.status_code == 200
    assert response.json()["list_id"] == travel
    assert response.json()["progress"]["level"] == "familiar"
    work_words = await client.get(f"/api/v1/lists/{work}/words", headers=auth["headers"])
    assert work_words.json()["total"] == 0


async def test_move_to_list_with_same_term_is_409(client: AsyncClient, auth: dict[str, Any]):
    work = await new_list(client, auth, "Công việc")
    travel = await new_list(client, auth, "Du lịch")
    word = await added(client, auth, work, term="deadline")
    existing = await added(client, auth, travel, term="Deadline", allow_duplicate=True)

    response = await client.patch(
        f"/api/v1/words/{word['id']}", json={"list_id": travel}, headers=auth["headers"]
    )

    err = error(response, 409)
    assert err["code"] == "DUPLICATE_WORD"
    assert err["details"] == {"existing_word_id": existing["id"]}


async def test_rename_to_existing_term_in_list_is_409(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    await added(client, auth, list_id, term="deadline")
    word = await added(client, auth, list_id, term="meeting")

    response = await client.patch(
        f"/api/v1/words/{word['id']}", json={"term": "DEADLINE"}, headers=auth["headers"]
    )
    same = await client.patch(
        f"/api/v1/words/{word['id']}", json={"term": "Meeting"}, headers=auth["headers"]
    )

    assert error(response, 409)["code"] == "DUPLICATE_WORD"
    assert same.status_code == 200 and same.json()["term"] == "Meeting"


async def test_cannot_move_to_other_users_list(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
):
    word = await added(client, auth, await new_list(client, auth), term="deadline")
    their_list = await new_list(client, other_auth, "Của B")

    response = await client.patch(
        f"/api/v1/words/{word['id']}", json={"list_id": their_list}, headers=auth["headers"]
    )

    assert error(response, 404)["code"] == "NOT_FOUND"


# --- Danh sách từ trong list -----------------------------------------------------------------


async def test_pagination(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    for i in range(1, 6):
        await added(client, auth, list_id, term=f"word{i}")
    url = f"/api/v1/lists/{list_id}/words"

    page = (await client.get(url, params={"limit": 2, "offset": 2}, headers=auth["headers"])).json()
    default = (await client.get(url, headers=auth["headers"])).json()
    too_big = await client.get(url, params={"limit": 201}, headers=auth["headers"])

    assert page["total"] == 5
    assert [w["term"] for w in page["items"]] == ["word3", "word4"]
    assert [w["term"] for w in default["items"]] == [f"word{i}" for i in range(1, 6)]
    assert error(too_big, 422)["code"] == "VALIDATION_ERROR"


async def test_list_filters(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
):
    list_id = await new_list(client, auth)
    new = await added(client, auth, list_id, term="agenda", meaning_vi="chương trình họp")
    learning = await added(client, auth, list_id, term="deadline", meaning_vi="hạn chót")
    familiar = await added(
        client, auth, list_id, term="meeting", meaning_vi="cuộc họp", is_starred=True
    )
    mastered = await added(client, auth, list_id, term="memo", meaning_vi="bản ghi nhớ")
    await set_progress(test_engine, learning["id"], interval_days=3, due_at=clock.current)
    await set_progress(test_engine, familiar["id"], interval_days=10, due_at=clock.current)
    await set_progress(
        test_engine, mastered["id"], interval_days=25, due_at=clock.current + timedelta(days=9)
    )

    async def terms(params: dict[str, Any]) -> list[str]:
        response = await client.get(
            f"/api/v1/lists/{list_id}/words", params=params, headers=auth["headers"]
        )
        assert response.status_code == 200, response.text
        return [w["term"] for w in response.json()["items"]]

    assert await terms({"level": "new"}) == [new["term"]]
    assert await terms({"level": "learning"}) == ["deadline"]
    assert await terms({"level": "familiar"}) == ["meeting"]
    assert await terms({"level": "mastered"}) == ["memo"]
    assert await terms({"starred": "true"}) == ["meeting"]
    assert await terms({"q": "me"}) == ["meeting", "memo"]  # tiền tố của từ
    assert await terms({"q": "hop"}) == ["agenda", "meeting"]  # nghĩa không dấu
    assert (
        await client.get(
            f"/api/v1/lists/{list_id}/words", params={"level": "x"}, headers=auth["headers"]
        )
    ).status_code == 422


# --- Tìm kiếm --------------------------------------------------------------------------------


async def search(client: AsyncClient, auth: dict[str, Any], q: str) -> list[str]:
    response = await client.get("/api/v1/words/search", params={"q": q}, headers=auth["headers"])
    assert response.status_code == 200, response.text
    return [w["term"] for w in response.json()]


async def test_search_meaning_without_accents(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth, "Công việc")
    await added(client, auth, list_id, term="deadline", meaning_vi="hạn chót")
    await added(client, auth, list_id, term="meeting", meaning_vi="cuộc họp")

    response = await client.get(
        "/api/v1/words/search", params={"q": "han chot"}, headers=auth["headers"]
    )

    assert response.status_code == 200
    [found] = response.json()
    assert (found["term"], found["meaning_vi"], found["list_name"]) == (
        "deadline",
        "hạn chót",
        "Công việc",
    )
    assert found["progress"]["level"] == "new"
    assert await search(client, auth, "  HẠN CHÓT ") == ["deadline"]


async def test_search_term_prefix_and_exact_first(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    for term in ["application", "apple", "app", "happy"]:
        await added(client, auth, list_id, term=term, meaning_vi="nghĩa")

    assert await search(client, auth, "dead") == []
    assert await search(client, auth, "app") == ["app", "apple", "application"]
    assert await search(client, auth, "APPL") == ["apple", "application"]


async def test_search_escapes_like_wildcards(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    await added(client, auth, list_id, term="discount", meaning_vi="giảm 50% giá")
    await added(client, auth, list_id, term="half", meaning_vi="một nửa, 50 phần trăm")
    await added(client, auth, list_id, term="snake_case", meaning_vi="kiểu đặt tên")
    await added(client, auth, list_id, term="snakecase", meaning_vi="viết liền")

    assert await search(client, auth, "50%") == ["discount"]
    assert await search(client, auth, "%") == ["discount"]
    assert await search(client, auth, "snake_") == ["snake_case"]  # "_" không là ký tự đại diện
    assert await search(client, auth, "\\") == []


async def test_search_limit_and_validation(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    for i in range(25):
        await added(client, auth, list_id, term=f"word{i:02d}")

    default = await client.get(
        "/api/v1/words/search", params={"q": "word"}, headers=auth["headers"]
    )
    limited = await client.get(
        "/api/v1/words/search", params={"q": "word", "limit": 5}, headers=auth["headers"]
    )
    empty = await client.get("/api/v1/words/search", params={"q": " "}, headers=auth["headers"])

    assert len(default.json()) == 20
    assert len(limited.json()) == 5
    assert empty.status_code == 422


# --- Quyền sở hữu ----------------------------------------------------------------------------


async def test_other_user_cannot_access_words(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
):
    list_id = await new_list(client, auth)
    word = await added(client, auth, list_id, term="deadline", meaning_vi="hạn chót")
    url = f"/api/v1/words/{word['id']}"
    headers = other_auth["headers"]

    responses = {
        "get": await client.get(url, headers=headers),
        "patch": await client.patch(url, json={"term": "x"}, headers=headers),
        "delete": await client.delete(url, headers=headers),
        "list": await client.get(f"/api/v1/lists/{list_id}/words", headers=headers),
        "add": await add(client, other_auth, list_id, term="hack"),
        "bulk": await client.post(
            f"/api/v1/lists/{list_id}/words/bulk",
            json={"words": [{"term": "hack", "meaning_vi": "x"}]},
            headers=headers,
        ),
    }

    assert {name: r.status_code for name, r in responses.items()} == dict.fromkeys(responses, 404)
    assert await search(client, other_auth, "deadline") == []
    assert await search(client, other_auth, "han chot") == []
    assert (await client.get(url, headers=auth["headers"])).json()["term"] == "deadline"


async def test_definition_en_saved_and_cleared(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    word = await added(
        client,
        auth,
        list_id,
        term="deadline",
        meaning_vi="hạn chót",
        definition_en="A time limit.\nA line that does not move.",
    )
    assert word["definition_en"] == "A time limit.\nA line that does not move."

    plain = await added(client, auth, list_id, term="agenda", meaning_vi="chương trình")
    assert plain["definition_en"] is None  # không có thì không lưu

    cleared = await client.patch(
        f"/api/v1/words/{word['id']}", json={"definition_en": None}, headers=auth["headers"]
    )
    assert cleared.json()["definition_en"] is None
    too_long = await add(client, auth, list_id, term="x", definition_en="a" * 1501)
    assert too_long.status_code == 422


# --- Mẹo nhớ, họ từ, cụm đi kèm, từ hay nhầm (P7.1) ------------------------------------------


async def test_create_and_update_word_insights(client: AsyncClient, auth: dict[str, Any]):
    list_id = await new_list(client, auth)
    tatoeba = {
        "en": "I decided to go.",
        "vi": "Tôi đã quyết định đi.",
        "source": "tatoeba",
        "source_id": "12345",
        "source_url": "https://tatoeba.org/en/sentences/show/12345",
    }
    examples = [tatoeba] + [{"en": f"Example {i}.", "vi": "", "source": "user"} for i in range(4)]

    word = await added(
        client,
        auth,
        list_id,
        term="decide",
        meaning_vi="quyết định",
        examples=examples,
        mnemonic="  Đi xài: quyết định đi xài tiền. ",
        word_family=[FAMILY],
        collocations=[COLLOCATION],
        confusables=[CONFUSABLE],
    )

    assert len(word["examples"]) == 5
    assert word["examples"][0] == tatoeba
    assert word["examples"][1] == {
        "en": "Example 0.",
        "vi": "",
        "source": "user",
        "source_id": None,
        "source_url": None,
    }
    assert word["mnemonic"] == "Đi xài: quyết định đi xài tiền."
    assert word["word_family"] == [FAMILY]
    assert word["collocations"] == [COLLOCATION]
    assert word["confusables"] == [CONFUSABLE]
    assert word["progress"]["is_leech"] is False

    url = f"/api/v1/words/{word['id']}"
    other = {**CONFUSABLE, "term": "conclude", "other_example_en": "We concluded the talk."}
    patched = await client.patch(
        url,
        json={"mnemonic": None, "collocations": [], "confusables": [CONFUSABLE, other]},
        headers=auth["headers"],
    )
    assert patched.status_code == 200, patched.text

    body = (await client.get(url, headers=auth["headers"])).json()
    assert body["mnemonic"] is None
    assert body["collocations"] == []
    assert body["confusables"] == [CONFUSABLE, other]
    assert body["word_family"] == [FAMILY]  # không gửi thì giữ nguyên
    assert body["examples"][0] == tatoeba


@pytest.mark.parametrize(
    "body",
    [
        {"examples": [{"en": "a"}] * 6},
        {"word_family": None},
        {"confusables": [CONFUSABLE] * 3},
        {"mnemonic": "m" * 301},
    ],
)
async def test_update_insights_validation_error(
    client: AsyncClient, auth: dict[str, Any], body: dict
):
    word = await added(client, auth, await new_list(client, auth), term="decide")

    response = await client.patch(f"/api/v1/words/{word['id']}", json=body, headers=auth["headers"])

    assert error(response, 422)["code"] == "VALIDATION_ERROR"


async def test_old_word_has_empty_insights(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
):
    word = await added(client, auth, await new_list(client, auth), term="deadline")
    # Ví dụ kiểu cũ, lưu trước P7.1: chỉ có en, vi.
    async with AsyncSession(test_engine) as session:
        await session.execute(
            update(Word)
            .where(Word.id == uuid.UUID(word["id"]))
            .values(examples=[{"en": "Meet the deadline.", "vi": "Kịp hạn."}])
        )
        await session.commit()

    body = (await client.get(f"/api/v1/words/{word['id']}", headers=auth["headers"])).json()

    assert body["mnemonic"] is None
    assert (body["word_family"], body["collocations"], body["confusables"]) == ([], [], [])
    assert body["examples"] == [
        {
            "en": "Meet the deadline.",
            "vi": "Kịp hạn.",
            "source": None,
            "source_id": None,
            "source_url": None,
        }
    ]
    assert body["progress"]["is_leech"] is False
