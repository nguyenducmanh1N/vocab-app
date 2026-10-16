import uuid
from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import Word
from tests.conftest import FakeClock
from tests.study_helpers import DAY, Seeder, new_list

URL = "/api/v1/notifications/word-feed"


async def feed(client: AsyncClient, auth: dict[str, Any], **params: Any) -> list[dict[str, Any]]:
    response = await client.get(URL, params=params, headers=auth["headers"])
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def set_examples(engine: AsyncEngine, word_id: str, examples: list[dict[str, str]]) -> None:
    async with AsyncSession(engine) as session:
        await session.execute(
            update(Word).where(Word.id == uuid.UUID(word_id)).values(examples=examples)
        )
        await session.commit()


async def test_notification_feed_priority_order_without_duplicates(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    # thêm theo thứ tự lộn xộn để chắc chắn thứ tự trả về do luật ưu tiên quyết định
    await seed.word(list_id, "rest_a", due=30 * DAY, interval=30)
    await seed.word(list_id, "star_new", starred=True)  # từ mới gắn sao
    await seed.word(list_id, "soon_2d", due=2 * DAY, interval=10)  # đến hạn trong 3 ngày
    await seed.word(list_id, "learning_late", due=5 * DAY, interval=5)
    await seed.word(list_id, "learning_early", due=-DAY, interval=2, starred=True)  # cả 2 nhóm
    await seed.word(list_id, "soon_1d", due=DAY, interval=12)
    await seed.word(list_id, "later_4d", due=4 * DAY, interval=15)  # ngoài 3 ngày
    await seed.word(list_id, "star_old", due=20 * DAY, interval=20, starred=True)

    items = await feed(client, auth, days=7, per_day=3)

    terms = [item["term"] for item in items]
    assert terms[:6] == [
        "learning_early",  # 1. Đang học, theo due_at
        "learning_late",
        "soon_1d",  # 2. đến hạn trong 3 ngày
        "soon_2d",
        "star_new",  # 3. gắn sao (theo thứ tự thêm), không lặp lại learning_early
        "star_old",
    ]
    assert sorted(terms[6:]) == ["later_4d", "rest_a"]  # 4. còn lại (ngẫu nhiên)
    assert len(terms) == len(set(terms)) == 8


async def test_notification_feed_takes_days_times_per_day_max_70(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    for i in range(80):
        await seed.word(
            list_id, f"w{i:02}", due=(i % 9 - 2) * DAY, interval=i % 10, starred=i % 4 == 0
        )

    assert len(await feed(client, auth, days=2, per_day=3)) == 6
    full = await feed(client, auth, days=7, per_day=10)
    assert len(full) == 70
    assert len({item["word_id"] for item in full}) == 70
    assert len(await feed(client, auth)) == 21  # mặc định days=7, per_day=3


async def test_notification_feed_item_fields_and_first_example(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    with_example = await seed.word(list_id, "deadline", due=-DAY, interval=1)
    await set_examples(
        test_engine,
        with_example,
        [
            {"en": "The deadline is Friday.", "vi": "Hạn chót là thứ Sáu."},
            {"en": "Second example.", "vi": "Ví dụ thứ hai."},
        ],
    )
    await seed.word(list_id, "plain", due=-timedelta(hours=1), interval=1)

    items = await feed(client, auth, days=1, per_day=2)

    assert items[0] == {
        "word_id": with_example,
        "term": "deadline",
        "part_of_speech": None,  # Seeder không đặt loại từ
        "meaning_vi": "nghĩa deadline",
        "example_en": "The deadline is Friday.",
        "example_vi": "Hạn chót là thứ Sáu.",
    }
    assert items[1]["term"] == "plain"
    assert (items[1]["example_en"], items[1]["example_vi"]) == (None, None)


async def test_notification_feed_only_own_words(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
) -> None:
    other = Seeder(test_engine, clock, other_auth["user"]["id"])
    await other.word(await new_list(client, other_auth), "foreign", due=-DAY, interval=1)
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    await seed.word(await new_list(client, auth), "mine")

    assert [item["term"] for item in await feed(client, auth)] == ["mine"]


async def test_notification_feed_empty_validation_and_auth(
    client: AsyncClient, auth: dict[str, Any]
) -> None:
    assert await feed(client, auth) == []
    for params in ({"days": 0}, {"days": 8}, {"per_day": 0}, {"per_day": 11}):
        response = await client.get(URL, params=params, headers=auth["headers"])
        assert response.status_code == 422, params
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert (await client.get(URL)).status_code == 401
