import uuid
from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import Word, WordList, WordProgress
from tests.conftest import FakeClock

URL = "/api/v1/lists"


async def create(client: AsyncClient, auth: dict[str, Any], **body: Any) -> Response:
    return await client.post(URL, json=body, headers=auth["headers"])


async def created(client: AsyncClient, auth: dict[str, Any], **body: Any) -> dict[str, Any]:
    response = await create(client, auth, **body)
    assert response.status_code == 201, response.text
    return response.json()


async def new_category(client: AsyncClient, auth: dict[str, Any], name: str) -> str:
    response = await client.post("/api/v1/categories", json={"name": name}, headers=auth["headers"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def add_words(
    engine: AsyncEngine,
    user_id: str,
    list_id: str,
    progress: list[tuple[int, timedelta | None]],
    clock: FakeClock,
) -> None:
    """Mỗi phần tử là (interval_days, due_at - now); None = từ mới chưa học."""
    async with AsyncSession(engine) as session:
        for i, (interval, due_offset) in enumerate(progress):
            word = Word(user_id=user_id, list_id=list_id, term=f"word{i}", meaning_vi="nghĩa")
            session.add(word)
            await session.flush()
            session.add(
                WordProgress(
                    word_id=word.id,
                    user_id=user_id,
                    interval_days=interval,
                    due_at=None if due_offset is None else clock.current + due_offset,
                )
            )
        await session.commit()


def stats(item: dict[str, Any]) -> tuple[int, int, int]:
    return item["word_count"], item["mastered_count"], item["due_count"]


# --- Số liệu ---------------------------------------------------------------------------------


async def test_counts_with_all_levels(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
):
    user_id = auth["user"]["id"]
    first = await created(client, auth, name="Du lịch")
    second = await created(client, auth, name="Công việc")
    empty = await created(client, auth, name="Trống")
    day = timedelta(days=1)
    await add_words(
        test_engine,
        user_id,
        first["id"],
        [
            (0, None),  # new
            (3, -day),  # learning, đến hạn
            (10, day),  # familiar, chưa đến hạn
            (21, timedelta(0)),  # mastered, đến hạn đúng lúc này (due_at ≤ now)
            (30, 5 * day),  # mastered, chưa đến hạn
        ],
        clock,
    )
    await add_words(test_engine, user_id, second["id"], [(0, None), (1, day), (7, -2 * day)], clock)
    # Từ của user khác không ảnh hưởng số liệu của A
    other_list = await created(client, other_auth, name="Của B")
    await add_words(
        test_engine, other_auth["user"]["id"], other_list["id"], [(30, -day)] * 2, clock
    )

    response = await client.get(URL, headers=auth["headers"])

    assert response.status_code == 200
    by_name = {item["name"]: stats(item) for item in response.json()}
    assert by_name == {
        "Du lịch": (5, 2, 2),
        "Công việc": (3, 0, 1),
        "Trống": (0, 0, 0),
    }
    detail = (await client.get(f"{URL}/{first['id']}", headers=auth["headers"])).json()
    assert stats(detail) == (5, 2, 2)
    empty_detail = (await client.get(f"{URL}/{empty['id']}", headers=auth["headers"])).json()
    assert stats(empty_detail) == (0, 0, 0)

    # Một ngày sau: từ familiar (due +1 ngày) cũng đến hạn. Access token 15 phút đã hết hạn
    # theo đồng hồ giả nên lấy token mới bằng refresh.
    clock.advance(days=1)
    refreshed = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": auth["tokens"]["refresh_token"]}
    )
    headers = {"Authorization": f"Bearer {refreshed.json()['access_token']}"}
    detail = (await client.get(f"{URL}/{first['id']}", headers=headers)).json()
    assert stats(detail) == (5, 2, 3)


@pytest.fixture
def count_queries(test_engine: AsyncEngine) -> Iterator[list[str]]:
    statements: list[str] = []

    def record(conn: Any, cursor: Any, statement: str, *args: Any) -> None:
        statements.append(statement)

    event.listen(test_engine.sync_engine, "before_cursor_execute", record)
    yield statements
    event.remove(test_engine.sync_engine, "before_cursor_execute", record)


async def test_list_stats_use_one_query(
    client: AsyncClient,
    auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
    count_queries: list[str],
):
    for i in range(4):
        word_list = await created(client, auth, name=f"List {i}")
        await add_words(test_engine, auth["user"]["id"], word_list["id"], [(0, None)] * 3, clock)
    count_queries.clear()

    response = await client.get(URL, headers=auth["headers"])

    assert response.status_code == 200 and len(response.json()) == 4
    selects = [s for s in count_queries if s.lstrip().upper().startswith("SELECT")]
    # 1 câu tải user (get_current_user) + 1 câu gộp cho mọi list
    assert len(selects) == 2, selects


# --- CRUD ------------------------------------------------------------------------------------


async def test_create_defaults_and_ai_source(client: AsyncClient, auth: dict[str, Any]):
    manual = await created(client, auth, name="  Từ vựng IELTS  ", description="Ôn thi")
    ai = await created(client, auth, name="Cà phê", source="ai", ai_topic="coffee shop")

    assert manual["name"] == "Từ vựng IELTS"
    assert (manual["source"], manual["ai_topic"], manual["category_id"]) == ("manual", None, None)
    assert stats(manual) == (0, 0, 0)
    assert (ai["source"], ai["ai_topic"]) == ("ai", "coffee shop")


async def test_get_update_delete(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
):
    category_id = await new_category(client, auth, "Du lịch")
    word_list = await created(client, auth, name="Sân bay", description="mô tả")
    await add_words(test_engine, auth["user"]["id"], word_list["id"], [(0, None)] * 2, clock)
    url = f"{URL}/{word_list['id']}"

    got = await client.get(url, headers=auth["headers"])
    assert got.status_code == 200 and got.json()["name"] == "Sân bay"

    patched = await client.patch(
        url,
        json={"name": "Ở sân bay", "description": None, "category_id": category_id},
        headers=auth["headers"],
    )
    assert patched.status_code == 200
    body = patched.json()
    assert (body["name"], body["description"], body["category_id"]) == (
        "Ở sân bay",
        None,
        category_id,
    )
    assert body["updated_at"] >= word_list["updated_at"]
    assert body["word_count"] == 2

    moved_out = await client.patch(url, json={"category_id": None}, headers=auth["headers"])
    assert moved_out.json()["category_id"] is None

    deleted = await client.delete(url, headers=auth["headers"])
    assert deleted.status_code == 204
    assert (await client.get(url, headers=auth["headers"])).status_code == 404
    async with AsyncSession(test_engine) as session:
        for model in (WordList, Word, WordProgress):
            assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_list_sorted_by_updated_at_desc(client: AsyncClient, auth: dict[str, Any]):
    first = await created(client, auth, name="Một")
    await created(client, auth, name="Hai")
    await created(client, auth, name="Ba")
    await client.patch(f"{URL}/{first['id']}", json={"name": "Một*"}, headers=auth["headers"])

    names = [item["name"] for item in (await client.get(URL, headers=auth["headers"])).json()]

    assert names == ["Một*", "Ba", "Hai"]


# --- Bộ lọc ----------------------------------------------------------------------------------


async def test_filters(client: AsyncClient, auth: dict[str, Any]):
    travel = await new_category(client, auth, "Du lịch")
    work = await new_category(client, auth, "Công việc")
    await created(client, auth, name="Sân bay", category_id=travel)
    await created(client, auth, name="Khách sạn", category_id=travel)
    await created(client, auth, name="Họp", category_id=work)
    await created(client, auth, name="Đi lại hằng ngày")
    await created(client, auth, name="100% phrasal verbs")

    async def names(params: dict[str, Any]) -> set[str]:
        response = await client.get(URL, params=params, headers=auth["headers"])
        assert response.status_code == 200, response.text
        return {item["name"] for item in response.json()}

    assert await names({"category_id": travel}) == {"Sân bay", "Khách sạn"}
    assert await names({"category_id": work}) == {"Họp"}
    assert await names({"uncategorized": "true"}) == {"Đi lại hằng ngày", "100% phrasal verbs"}
    assert await names({"q": "SAN BAY"}) == {"Sân bay"}  # không phân biệt hoa thường, dấu
    assert await names({"q": "di lai"}) == {"Đi lại hằng ngày"}
    assert await names({"q": "%"}) == {"100% phrasal verbs"}  # ký tự % được escape
    assert await names({"q": "khách", "category_id": travel}) == {"Khách sạn"}
    assert len(await names({})) == 5


async def test_category_id_and_uncategorized_together_is_422(
    client: AsyncClient, auth: dict[str, Any]
):
    params = {"category_id": str(uuid.uuid4()), "uncategorized": "true"}

    response = await client.get(URL, params=params, headers=auth["headers"])

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": "x" * 101},
        {"name": "A", "source": "web"},
        {"name": "A", "ai_topic": "x" * 201},
        {"name": "A", "khoa_la": 1},
    ],
)
async def test_create_validation_error(client: AsyncClient, auth: dict[str, Any], body: dict):
    assert (await client.post(URL, json=body, headers=auth["headers"])).status_code == 422


async def test_update_null_name_is_422(client: AsyncClient, auth: dict[str, Any]):
    word_list = await created(client, auth, name="A")

    response = await client.patch(
        f"{URL}/{word_list['id']}", json={"name": None}, headers=auth["headers"]
    )

    assert response.status_code == 422


# --- Quyền sở hữu ----------------------------------------------------------------------------


async def test_other_user_cannot_access_list(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
):
    word_list = await created(client, auth, name="Của A")
    url = f"{URL}/{word_list['id']}"
    headers = other_auth["headers"]

    responses = [
        await client.get(url, headers=headers),
        await client.patch(url, json={"name": "Của B"}, headers=headers),
        await client.delete(url, headers=headers),
    ]

    assert [r.status_code for r in responses] == [404, 404, 404]
    assert all(r.json()["error"]["code"] == "NOT_FOUND" for r in responses)
    assert (await client.get(URL, headers=headers)).json() == []
    assert (await client.get(url, headers=auth["headers"])).json()["name"] == "Của A"


async def test_cannot_use_other_users_category(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
):
    their_category = await new_category(client, other_auth, "Của B")
    mine = await created(client, auth, name="Của A")

    create_response = await create(client, auth, name="X", category_id=their_category)
    move_response = await client.patch(
        f"{URL}/{mine['id']}", json={"category_id": their_category}, headers=auth["headers"]
    )
    filtered = await client.get(
        URL, params={"category_id": their_category}, headers=auth["headers"]
    )

    assert create_response.status_code == move_response.status_code == 404
    assert filtered.json() == []


async def test_unknown_category_is_404(client: AsyncClient, auth: dict[str, Any]):
    response = await create(client, auth, name="X", category_id=str(uuid.uuid4()))

    assert response.status_code == 404


# --- Nhân bản (POST /lists/{id}/duplicate) ---


async def add_word(client: AsyncClient, auth: dict[str, Any], list_id: str, **body: Any) -> dict:
    response = await client.post(f"{URL}/{list_id}/words", json=body, headers=auth["headers"])
    assert response.status_code == 201, response.text
    return response.json()


async def test_duplicate_copies_words_in_order_without_progress(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
) -> None:
    category_id = await new_category(client, auth, "Du lịch")
    original = await created(
        client,
        auth,
        name="Sân bay",
        category_id=category_id,
        description="Từ ở sân bay",
        source="ai",
        ai_topic="sân bay",
    )
    full = {
        "term": "boarding pass",
        "meaning_vi": "thẻ lên máy bay",
        "definition_en": "a card you show to board a plane",
        "part_of_speech": "phrase",
        "ipa": "/ˈbɔːrdɪŋ pæs/",
        "synonyms": ["boarding card"],
        "examples": [
            {
                "en": "Show your boarding pass.",
                "vi": "Xuất trình thẻ lên máy bay.",
                "source": "user",
                "source_id": None,
                "source_url": None,
            }
        ],
        "audio_url": "https://example.com/a.mp3",
        "note": "quầy check-in",
        "is_starred": True,
    }
    first = await add_word(client, auth, original["id"], **full)
    for term in ["gate", "luggage", "delay"]:
        await add_word(client, auth, original["id"], term=term, meaning_vi=f"nghĩa {term}")
    async with AsyncSession(test_engine) as session:  # từ gốc đã học: tiến độ không được chép
        progress = await session.get(WordProgress, uuid.UUID(first["id"]))
        progress.interval_days, progress.repetitions, progress.correct_count = 30, 4, 9
        progress.due_at = func.now()
        await session.commit()

    response = await client.post(f"{URL}/{original['id']}/duplicate", headers=auth["headers"])

    assert response.status_code == 201, response.text
    copy = response.json()
    assert copy["id"] != original["id"]
    assert copy["name"] == "Sân bay (bản sao)"
    assert (copy["category_id"], copy["description"], copy["source"], copy["ai_topic"]) == (
        category_id,
        "Từ ở sân bay",
        "ai",
        "sân bay",
    )
    assert stats(copy) == (4, 0, 0)

    words = (await client.get(f"{URL}/{copy['id']}/words", headers=auth["headers"])).json()["items"]
    assert [w["term"] for w in words] == ["boarding pass", "gate", "luggage", "delay"]
    copied = words[0]
    assert {key: copied[key] for key in full} == full
    assert copied["id"] != first["id"] and copied["list_id"] == copy["id"]
    assert copied["progress"]["due_at"] is None
    assert copied["progress"]["correct_count"] == copied["progress"]["repetitions"] == 0

    # List gốc giữ nguyên.
    again = (await client.get(f"{URL}/{original['id']}", headers=auth["headers"])).json()
    assert stats(again)[0] == 4
    assert again["name"] == "Sân bay"


async def test_duplicate_empty_list_and_long_name(
    client: AsyncClient, auth: dict[str, Any]
) -> None:
    original = await created(client, auth, name="x" * 100)

    response = await client.post(f"{URL}/{original['id']}/duplicate", headers=auth["headers"])

    assert response.status_code == 201
    copy = response.json()
    assert copy["name"] == "x" * 90 + " (bản sao)"
    assert len(copy["name"]) == 100
    assert stats(copy) == (0, 0, 0)
    assert copy["category_id"] is None


async def test_duplicate_twice_gives_two_copies(client: AsyncClient, auth: dict[str, Any]) -> None:
    original = await created(client, auth, name="Gốc")
    for _ in range(2):
        assert (
            await client.post(f"{URL}/{original['id']}/duplicate", headers=auth["headers"])
        ).status_code == 201

    names = sorted(item["name"] for item in (await client.get(URL, headers=auth["headers"])).json())
    assert names == ["Gốc", "Gốc (bản sao)", "Gốc (bản sao)"]


async def test_duplicate_other_users_list_is_404(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    original = await created(client, auth, name="Của An")

    response = await client.post(f"{URL}/{original['id']}/duplicate", headers=other_auth["headers"])
    missing = await client.post(f"{URL}/{uuid.uuid4()}/duplicate", headers=auth["headers"])
    anonymous = await client.post(f"{URL}/{original['id']}/duplicate")

    assert [response.status_code, missing.status_code, anonymous.status_code] == [404, 404, 401]
    assert response.json()["error"]["code"] == "NOT_FOUND"
    assert len((await client.get(URL, headers=other_auth["headers"])).json()) == 0
