import uuid
from datetime import datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.time import local_today, start_of_local_day
from app.models import DailyActivity, ReviewLog, StudySession
from tests.conftest import FakeClock
from tests.study_helpers import DAY, TZ, Seeder, new_list, set_settings

URL = "/api/v1/study/queue"


async def queue(client: AsyncClient, auth: dict[str, Any], **params: Any) -> Response:
    query = {k: str(v).lower() if isinstance(v, bool) else v for k, v in params.items()}
    return await client.get(URL, params=query, headers=auth["headers"])


async def queue_ok(client: AsyncClient, auth: dict[str, Any], **params: Any) -> dict[str, Any]:
    response = await queue(client, auth, **params)
    assert response.status_code == 200, response.text
    return response.json()


def terms(body: dict[str, Any]) -> list[str]:
    return [card["term"] for card in body["cards"]]


def local_day_start() -> datetime:
    return start_of_local_day(local_today(TZ), TZ)


# --- Ôn tập hôm nay ---------------------------------------------------------------------------


async def test_queue_due_ordered_by_due_at(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    await seed.word(list_id, "middle", due=-2 * DAY, interval=3)
    await seed.word(list_id, "oldest", due=-5 * DAY, interval=3)
    await seed.word(list_id, "latest", due=timedelta(minutes=-1), interval=3)
    await seed.word(list_id, "later", due=DAY, interval=3)  # chưa đến hạn

    body = await queue_ok(client, auth)

    assert terms(body) == ["oldest", "middle", "latest"]
    assert all(card["is_due"] and not card["is_new"] for card in body["cards"])
    assert body["stats"] == {"due_total": 3, "new_available": 0}


async def test_queue_interleaves_one_new_after_four_due(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    for i in range(3):
        await seed.word(list_id, f"n{i + 1}")  # created_at tăng dần: n1, n2, n3
    for i in range(9):
        await seed.word(list_id, f"d{i + 1}", due=-(9 - i) * timedelta(hours=1), interval=2)

    body = await queue_ok(client, auth)

    assert terms(body) == [
        "d1", "d2", "d3", "d4", "n1", "d5", "d6", "d7", "d8", "n2", "d9", "n3",
    ]  # fmt: skip
    new_flags = [card["is_new"] for card in body["cards"]]
    assert new_flags == [term.startswith("n") for term in terms(body)]
    assert body["stats"] == {"due_total": 9, "new_available": 3}


async def test_queue_new_quota_minus_new_words_today(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    await set_settings(client, auth, daily_new_words=10)
    for i in range(5):
        await seed.word(list_id, f"n{i + 1}")
    today = local_today(TZ)
    user_uuid = uuid.UUID(user_id)  # khoá chính kép: phải đúng kiểu UUID, không dùng chuỗi
    async with AsyncSession(test_engine) as session:
        session.add(DailyActivity(user_id=user_uuid, activity_date=today, new_words=8))
        session.add(DailyActivity(user_id=user_uuid, activity_date=today - DAY, new_words=10))
        await session.commit()

    body = await queue_ok(client, auth)

    assert terms(body) == ["n1", "n2"]  # 10 - 8 đã học hôm nay; hôm qua không tính
    assert body["stats"] == {"due_total": 0, "new_available": 2}

    await set_settings(client, auth, daily_new_words=5)  # đã học quá hạn mức → không âm
    body = await queue_ok(client, auth)
    assert terms(body) == []
    assert body["stats"]["new_available"] == 0


async def test_queue_extra_new_beyond_daily_quota(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    other_list = await new_list(client, auth, "Khác")
    await set_settings(client, auth, daily_new_words=10)
    for i in range(8):
        await seed.word(list_id, f"n{i + 1}")
    async with AsyncSession(test_engine) as session:
        session.add(
            DailyActivity(user_id=uuid.UUID(user_id), activity_date=local_today(TZ), new_words=10)
        )
        await session.commit()

    # Đã học đủ 10 từ mới hôm nay: không còn từ mới
    assert (await queue_ok(client, auth))["stats"]["new_available"] == 0

    # Học thêm 5 từ ngoài hạn mức
    body = await queue_ok(client, auth, extra_new=5)
    assert terms(body) == ["n1", "n2", "n3", "n4", "n5"]
    assert body["stats"]["new_available"] == 5

    # Không vượt quá số từ mới đang có
    assert (await queue_ok(client, auth, extra_new=20))["stats"]["new_available"] == 8

    # Học theo list vốn không áp hạn mức: extra_new không đổi gì
    await seed.word(other_list, "x1")
    by_list = await queue_ok(client, auth, list_id=other_list, extra_new=5)
    assert terms(by_list) == ["x1"]

    for bad in (-1, 21):
        response = await queue(client, auth, extra_new=bad)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_queue_review_quota_minus_reviews_today(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    await set_settings(client, auth, max_reviews_per_day=10)  # mức thấp nhất cho phép
    for i in range(12):
        await seed.word(list_id, f"d{i + 1:02}", due=-(12 - i) * timedelta(hours=1), interval=2)
    logged_word = await seed.word(list_id, "logged", due=DAY, interval=2)

    start = local_day_start()
    async with AsyncSession(test_engine) as session:
        study = StudySession(
            user_id=user_id,
            client_session_id=uuid.uuid4(),
            mode="review",
            started_at=start - timedelta(minutes=5),
        )
        session.add(study)
        await session.flush()

        def log(at: datetime, *, counted: bool = True, interval_before: int = 2) -> ReviewLog:
            return ReviewLog(
                user_id=user_id,
                word_id=logged_word,
                session_id=study.id,
                client_answer_id=uuid.uuid4(),
                mode="review",
                quality=4,
                is_correct=True,
                is_first_attempt=True,
                counted_for_srs=counted,
                interval_before=interval_before,
                interval_after=5,
                reviewed_at=at,
            )

        just_after_midnight = start + timedelta(minutes=1)
        session.add_all(
            [
                log(just_after_midnight),
                log(just_after_midnight),
                log(just_after_midnight),
                log(just_after_midnight, interval_before=0),  # lượt học từ mới
                log(just_after_midnight, counted=False),  # học trước hạn, không đổi lịch
                log(start - timedelta(minutes=1)),  # 23:59 hôm qua (giờ VN)
            ]
        )
        await session.commit()

    body = await queue_ok(client, auth)

    assert terms(body) == [f"d{i:02}" for i in range(1, 8)]  # 10 - 3 lượt ôn hôm nay
    assert body["stats"]["due_total"] == 12


async def test_queue_respects_limit(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    await set_settings(client, auth, daily_new_words=50)
    for i in range(25):
        await seed.word(list_id, f"n{i + 1:02}")

    assert len((await queue_ok(client, auth))["cards"]) == 20  # mặc định
    assert len((await queue_ok(client, auth, limit=100))["cards"]) == 25
    assert len((await queue_ok(client, auth, limit=3))["cards"]) == 3
    assert len((await queue_ok(client, auth, list_id=list_id, limit=50))["cards"]) == 25

    for params in ({"limit": 101}, {"limit": 0}, {"list_id": list_id, "limit": 51}):
        response = await queue(client, auth, **params)
        assert response.status_code == 422, params
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_queue_rejects_unknown_mode(client: AsyncClient, auth: dict[str, Any]) -> None:
    assert (await queue(client, auth, mode="mcq")).status_code == 200
    assert (await queue(client, auth, mode="karaoke")).status_code == 422


# --- Học theo list ---------------------------------------------------------------------------


async def test_queue_list_mode_ignores_daily_quotas(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    other_list = await new_list(client, auth, "Khác")
    await set_settings(client, auth, daily_new_words=0)
    await seed.word(list_id, "reviewed", due=3 * DAY, interval=7, last_reviewed=-2 * DAY)
    await seed.word(list_id, "new1")
    await seed.word(list_id, "never", due=5 * DAY, interval=7)  # last_reviewed_at null
    await seed.word(list_id, "due", due=-DAY, interval=3)
    await seed.word(list_id, "new2")
    await seed.word(list_id, "older", due=DAY, interval=7, last_reviewed=-6 * DAY)
    await seed.word(other_list, "elsewhere", due=-2 * DAY, interval=3)

    body = await queue_ok(client, auth, list_id=list_id)

    assert terms(body) == ["due", "new1", "new2", "never", "older", "reviewed"]
    assert [(c["is_due"], c["is_new"]) for c in body["cards"][:3]] == [
        (True, False),
        (False, True),
        (False, True),
    ]
    assert body["stats"] == {"due_total": 1, "new_available": 2}

    # Ôn tập hôm nay vẫn áp hạn mức: daily_new_words = 0 → không có từ mới
    review = await queue_ok(client, auth)
    assert terms(review) == ["elsewhere", "due"]  # toàn kho, hạn sớm nhất trước
    assert review["stats"]["new_available"] == 0


async def test_queue_list_of_other_user_is_404(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    list_id = await new_list(client, other_auth)
    response = await queue(client, auth, list_id=list_id)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_queue_requires_auth(client: AsyncClient) -> None:
    assert (await client.get(URL)).status_code == 401


# --- starred_only ----------------------------------------------------------------------------


async def test_queue_starred_only(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    await seed.word(list_id, "due_star", due=-DAY, interval=2, starred=True)
    await seed.word(list_id, "due_plain", due=-2 * DAY, interval=2)
    await seed.word(list_id, "new_star", starred=True)
    await seed.word(list_id, "new_plain")
    await seed.word(list_id, "later_star", due=DAY, interval=8, starred=True)

    review = await queue_ok(client, auth, starred_only=True)
    assert terms(review) == ["due_star", "new_star"]
    assert review["stats"] == {"due_total": 1, "new_available": 1}

    by_list = await queue_ok(client, auth, list_id=list_id, starred_only=True)
    assert terms(by_list) == ["due_star", "new_star", "later_star"]
    assert by_list["stats"] == {"due_total": 1, "new_available": 1}

    assert len((await queue_ok(client, auth))["cards"]) == 4  # mặc định lấy cả từ không sao


# --- distractor_pool -------------------------------------------------------------------------


async def test_queue_distractor_pool_excludes_cards(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_a = await new_list(client, auth, "A")
    list_b = await new_list(client, auth, "B")
    a_ids = [await seed.word(list_a, f"a{i + 1}") for i in range(5)]
    await seed.word(list_b, "A1")  # cùng term với một thẻ (khác hoa thường) → không được làm nhiễu
    b_ids = {await seed.word(list_b, f"b{i + 1:02}") for i in range(40)}
    other_seed = Seeder(test_engine, clock, other_auth["user"]["id"])
    other_list = await new_list(client, other_auth, "Của B")
    other_ids = {await other_seed.word(other_list, f"x{i}") for i in range(5)}

    body = await queue_ok(client, auth, list_id=list_a, limit=3)

    assert terms(body) == ["a1", "a2", "a3"]
    pool = body["distractor_pool"]
    pool_ids = {item["word_id"] for item in pool}
    card_ids = {card["id"] for card in body["cards"]}
    assert len(pool) == 30
    assert len(pool_ids) == 30
    assert not pool_ids & card_ids
    assert not {item["term"].lower() for item in pool} & {"a1", "a2", "a3"}
    assert set(a_ids[3:]) <= pool_ids  # ưu tiên cùng list
    assert pool_ids - set(a_ids) <= b_ids  # phần còn lại lấy trong kho của chính user
    assert not pool_ids & other_ids
    assert set(pool[0]) == {"word_id", "term", "meaning_vi", "part_of_speech"}


async def test_queue_distractor_pool_small_library(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    for i in range(4):
        await seed.word(list_id, f"w{i}")

    body = await queue_ok(client, auth)

    assert len(body["cards"]) == 4
    assert body["distractor_pool"] == []
