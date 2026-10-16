import uuid
from datetime import date, datetime, timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.security import create_access_token
from app.core.time import local_today, start_of_local_day
from app.models import DailyActivity, ReviewLog, StudySession, WordProgress
from tests.conftest import FakeClock
from tests.study_helpers import DAY, TZ, Seeder, new_list, set_settings

URL = "/api/v1/stats"


def headers_for(user_id: str) -> dict[str, str]:
    """Token theo đồng hồ giả (server so exp với now_utc)."""
    return {"Authorization": f"Bearer {create_access_token(uuid.UUID(user_id))[0]}"}


async def get_ok(client: AsyncClient, path: str, user_id: str, **params: Any) -> Any:
    response = await client.get(f"{URL}{path}", params=params, headers=headers_for(user_id))
    assert response.status_code == 200, response.text
    return response.json()


async def add_daily(engine: AsyncEngine, user_id: str, rows: dict[date, dict[str, int]]) -> None:
    async with AsyncSession(engine) as session:
        for day, values in rows.items():
            session.add(DailyActivity(user_id=uuid.UUID(user_id), activity_date=day, **values))
        await session.commit()


async def set_progress(engine: AsyncEngine, word_id: str, **values: Any) -> None:
    async with AsyncSession(engine) as session:
        await session.execute(
            update(WordProgress).where(WordProgress.word_id == uuid.UUID(word_id)).values(**values)
        )
        await session.commit()


async def add_logs(
    engine: AsyncEngine, user_id: str, word_id: str, logs: list[tuple[str, bool, bool, datetime]]
) -> None:
    """Mỗi log: (mode, is_correct, is_first_attempt, reviewed_at)."""
    async with AsyncSession(engine) as session:
        study = StudySession(
            user_id=uuid.UUID(user_id),
            client_session_id=uuid.uuid4(),
            mode="mcq",
            started_at=min(at for *_, at in logs),
        )
        session.add(study)
        await session.flush()
        for mode, correct, first, at in logs:
            session.add(
                ReviewLog(
                    user_id=uuid.UUID(user_id),
                    word_id=uuid.UUID(word_id),
                    session_id=study.id,
                    client_answer_id=uuid.uuid4(),
                    mode=mode,
                    quality=4 if correct else 1,
                    is_correct=correct,
                    is_first_attempt=first,
                    counted_for_srs=first,
                    reviewed_at=at,
                )
            )
        await session.commit()


# --- /stats/overview -----------------------------------------------------------------------------


async def test_stats_overview_levels_due_today_and_today(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    await set_settings(client, auth, daily_goal_cards=15)
    today = local_today(TZ)
    clock.set(start_of_local_day(today, TZ) + timedelta(hours=10))  # 10:00 giờ VN
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    tomorrow_start = start_of_local_day(today + DAY, TZ) - clock.current
    await seed.word(list_id, "new1")
    await seed.word(list_id, "new2")
    await seed.word(list_id, "overdue", due=-3 * DAY, interval=2)  # learning, quá hạn
    await seed.word(list_id, "tonight", due=timedelta(hours=13), interval=8)  # 23:00 hôm nay
    await seed.word(list_id, "tomorrow", due=tomorrow_start, interval=25)  # 00:00 mai
    await add_daily(
        test_engine,
        user_id,
        {
            today: {"cards_done": 16, "new_words": 4, "correct": 12},
            today - DAY: {"cards_done": 10},
            today - 2 * DAY: {"cards_done": 9},  # dưới ngưỡng 10: đứt chuỗi
            today - 3 * DAY: {"cards_done": 30},
            today - 4 * DAY: {"cards_done": 30},
            today - 5 * DAY: {"cards_done": 30},
        },
    )

    body = await get_ok(client, "/overview", user_id)

    assert body["levels"] == {"new": 2, "learning": 1, "familiar": 1, "mastered": 1}
    assert body["due_today"] == 2  # overdue + tonight, không tính tomorrow
    assert body["today"] == {
        "cards_done": 16,
        "goal": 15,
        "goal_met": True,
        "new_words": 4,
        "correct": 12,
    }
    assert (body["streak_current"], body["streak_best"]) == (2, 3)


async def test_stats_overview_empty_user(
    client: AsyncClient, auth: dict[str, Any], clock: FakeClock
) -> None:
    body = await get_ok(client, "/overview", auth["user"]["id"])
    assert body == {
        "streak_current": 0,
        "streak_best": 0,
        "today": {"cards_done": 0, "goal": 20, "goal_met": False, "new_words": 0, "correct": 0},
        "levels": {"new": 0, "learning": 0, "familiar": 0, "mastered": 0},
        "due_today": 0,
        "accuracy_30d": [],
    }


async def test_stats_overview_streak_kept_when_today_not_done_yet(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    today = local_today(TZ)
    await add_daily(
        test_engine,
        user_id,
        {
            today: {"cards_done": 3},
            today - DAY: {"cards_done": 12},
            today - 2 * DAY: {"cards_done": 10},
        },
    )
    body = await get_ok(client, "/overview", user_id)
    assert (body["streak_current"], body["streak_best"]) == (2, 2)


async def test_stats_accuracy_30d_ignores_repeats_and_old_logs(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    word = await seed.word(await new_list(client, auth), "word", due=DAY, interval=1)
    window_start = start_of_local_day(local_today(TZ) - 29 * DAY, TZ)
    now = clock.current
    await add_logs(
        test_engine,
        user_id,
        word,
        [
            ("mcq", True, True, now),
            ("mcq", False, True, now - DAY),
            ("mcq", True, False, now),  # câu hỏi lại: không tính
            ("mcq", False, False, now),  # câu hỏi lại: không tính
            ("typing", True, True, window_start),  # đúng mốc đầu cửa sổ 30 ngày: tính
            ("typing", False, True, window_start - timedelta(seconds=1)),  # ngoài cửa sổ
            ("flashcard", True, True, now - 10 * DAY),
        ],
    )

    body = await get_ok(client, "/overview", user_id)

    assert body["accuracy_30d"] == [
        {"mode": "flashcard", "total": 1, "correct": 1},
        {"mode": "mcq", "total": 2, "correct": 1},
        {"mode": "typing", "total": 1, "correct": 1},
    ]


# --- /stats/daily --------------------------------------------------------------------------------


async def test_stats_daily_fills_30_days_with_zeros(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    today = local_today(TZ)
    await add_daily(
        test_engine,
        user_id,
        {
            today: {"cards_done": 5, "correct": 4, "new_words": 2, "study_seconds": 300},
            today - 3 * DAY: {
                "cards_done": 12,
                "correct": 10,
                "new_words": 0,
                "study_seconds": 600,
            },
            today - 30 * DAY: {"cards_done": 99},  # ngoài 30 ngày
        },
    )

    body = await get_ok(client, "/daily", user_id)

    assert len(body) == 30
    dates = [date.fromisoformat(item["date"]) for item in body]
    assert dates == [today - (29 - i) * DAY for i in range(30)]  # tăng dần, kết thúc hôm nay
    by_date = {item["date"]: item for item in body}
    assert by_date[today.isoformat()] == {
        "date": today.isoformat(),
        "cards_done": 5,
        "correct": 4,
        "new_words": 2,
        "study_seconds": 300,
    }
    assert by_date[(today - 3 * DAY).isoformat()]["cards_done"] == 12
    zero_days = [
        item
        for item in body
        if item["date"] not in {today.isoformat(), (today - 3 * DAY).isoformat()}
    ]
    assert len(zero_days) == 28
    assert all(
        item["cards_done"] == item["correct"] == item["new_words"] == item["study_seconds"] == 0
        for item in zero_days
    )


async def test_stats_daily_uses_local_date_near_midnight(
    client: AsyncClient, auth: dict[str, Any], clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    local_midnight = start_of_local_day(local_today(TZ), TZ)

    clock.set(local_midnight - timedelta(minutes=1))  # 23:59 hôm qua giờ VN
    before = await get_ok(client, "/daily", user_id, days=7)
    clock.set(local_midnight + timedelta(minutes=1))  # 00:01 hôm nay giờ VN (vẫn hôm qua UTC)
    after = await get_ok(client, "/daily", user_id, days=7)

    assert len(before) == len(after) == 7
    assert date.fromisoformat(after[-1]["date"]) - date.fromisoformat(before[-1]["date"]) == DAY
    assert after[-1]["date"] == local_today(TZ).isoformat()


async def test_stats_daily_validates_days(
    client: AsyncClient, auth: dict[str, Any], clock: FakeClock
) -> None:
    for days in (0, 366):
        response = await client.get(
            f"{URL}/daily", params={"days": days}, headers=headers_for(auth["user"]["id"])
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert len(await get_ok(client, "/daily", auth["user"]["id"], days=365)) == 365


# --- /stats/hard-words ---------------------------------------------------------------------------


async def test_stats_hard_words_order_limit_and_owner(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    progress = {
        "easy": (0, 0),  # chưa sai lần nào: không lấy
        "a_wrong": (0, 3),
        "b_lapse": (2, 1),
        "c_lapse": (2, 4),
        "d_most": (5, 0),
        "e_wrong": (0, 3),
    }
    for term, (lapses, wrong) in progress.items():
        word_id = await seed.word(list_id, term, due=DAY, interval=1)
        await set_progress(test_engine, word_id, lapses=lapses, wrong_count=wrong)
    other = Seeder(test_engine, clock, other_auth["user"]["id"])
    other_word = await other.word(
        await new_list(client, other_auth), "foreign", due=DAY, interval=1
    )
    await set_progress(test_engine, other_word, lapses=9, wrong_count=9)

    body = await get_ok(client, "/hard-words", user_id)

    assert [item["term"] for item in body] == ["d_most", "c_lapse", "b_lapse", "a_wrong", "e_wrong"]
    assert body[0] == {
        "word_id": body[0]["word_id"],
        "term": "d_most",
        "meaning_vi": "nghĩa d_most",
        "wrong_count": 0,
        "lapses": 5,
    }
    limited = await get_ok(client, "/hard-words", user_id, limit=2)
    assert [item["term"] for item in limited] == ["d_most", "c_lapse"]
    for bad in (0, 51):
        response = await client.get(
            f"{URL}/hard-words", params={"limit": bad}, headers=headers_for(user_id)
        )
        assert response.status_code == 422


async def test_stats_endpoints_require_auth(client: AsyncClient) -> None:
    for path in ("/overview", "/daily", "/hard-words"):
        assert (await client.get(f"{URL}{path}")).status_code == 401
