import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.security import create_access_token
from app.core.time import local_today, start_of_local_day
from app.models import DailyActivity, ReviewLog, StudySession, WordProgress
from tests.conftest import FakeClock
from tests.study_helpers import DAY, TZ, Seeder, new_list, set_settings

URL = "/api/v1/study/sessions"


def answer(
    word_id: str,
    at: datetime,
    *,
    q: int = 4,
    correct: bool | None = None,
    first: bool = True,
    answer_id: str | None = None,
) -> dict[str, Any]:
    return {
        "client_answer_id": answer_id or str(uuid.uuid4()),
        "word_id": word_id,
        "quality": q,
        "is_correct": q >= 3 if correct is None else correct,
        "is_first_attempt": first,
        "response_ms": 2300,
        "answered_at": at.isoformat(),
    }


def session_body(
    answers: list[dict[str, Any]],
    started_at: datetime,
    *,
    session_id: str | None = None,
    mode: str = "review",
    finished: bool = False,
    ended_at: datetime | None = None,
    list_id: str | None = None,
) -> dict[str, Any]:
    return {
        "client_session_id": session_id or str(uuid.uuid4()),
        "list_id": list_id,
        "mode": mode,
        "started_at": started_at.isoformat(),
        "finished": finished,
        "ended_at": ended_at.isoformat() if ended_at else None,
        "answers": answers,
    }


async def post(client: AsyncClient, auth: dict[str, Any], body: dict[str, Any]) -> Response:
    return await client.post(URL, json=body, headers=auth["headers"])


async def post_ok(
    client: AsyncClient, auth: dict[str, Any], body: dict[str, Any]
) -> dict[str, Any]:
    response = await post(client, auth, body)
    assert response.status_code == 200, response.text
    return response.json()


async def progress_of(engine: AsyncEngine, word_id: str) -> WordProgress:
    async with AsyncSession(engine) as session:
        progress = await session.get(WordProgress, uuid.UUID(word_id))
        assert progress is not None
        return progress


async def daily(engine: AsyncEngine, user_id: str) -> dict[date, DailyActivity]:
    async with AsyncSession(engine) as session:
        rows = await session.scalars(
            select(DailyActivity).where(DailyActivity.user_id == uuid.UUID(user_id))
        )
        return {row.activity_date: row for row in rows}


async def logs(engine: AsyncEngine, word_id: str | None = None) -> list[ReviewLog]:
    async with AsyncSession(engine) as session:
        query = select(ReviewLog).order_by(ReviewLog.id)
        if word_id is not None:
            query = query.where(ReviewLog.word_id == uuid.UUID(word_id))
        return list(await session.scalars(query))


async def study_session(engine: AsyncEngine, session_id: str) -> StudySession:
    async with AsyncSession(engine) as session:
        study = await session.get(StudySession, uuid.UUID(session_id))
        assert study is not None
        return study


def snapshot(progress: WordProgress) -> tuple[Any, ...]:
    return (
        progress.ease_factor,
        progress.interval_days,
        progress.repetitions,
        progress.lapses,
        progress.due_at,
        progress.last_reviewed_at,
        progress.correct_count,
        progress.wrong_count,
    )


async def db_state(
    engine: AsyncEngine, user_id: str, word_ids: list[str], session_id: str
) -> tuple[Any, ...]:
    """Mọi thứ một lần gửi có thể thay đổi: lịch ôn, log, daily_activity, số liệu phiên."""
    study = await study_session(engine, session_id)
    return (
        [snapshot(await progress_of(engine, word_id)) for word_id in word_ids],
        [(log.id, log.is_first_attempt, log.counted_for_srs) for log in await logs(engine)],
        {
            day: (row.cards_done, row.correct, row.new_words, row.study_seconds, row.goal_met)
            for day, row in (await daily(engine, user_id)).items()
        },
        (study.total, study.correct, study.ended_at),
    )


def local_midnight(day: date) -> datetime:
    return start_of_local_day(day, TZ)


# --- Gửi lại không ghi trùng ---------------------------------------------------------------------


async def test_session_resend_same_payload_changes_nothing(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    new_word = await seed.word(list_id, "new")
    due_word = await seed.word(list_id, "due", due=-DAY, interval=1)
    now = clock.current
    body = session_body(
        [answer(new_word, now, q=4), answer(due_word, now, q=1), answer(new_word, now, q=5)],
        now - timedelta(minutes=5),
        finished=True,
        ended_at=now,
    )

    first = await post_ok(client, auth, body)
    assert (first["accepted"], first["duplicates"]) == (3, 0)
    words = [new_word, due_word]
    before = await db_state(test_engine, user_id, words, first["session_id"])

    clock.advance(minutes=1)
    again = await post_ok(client, auth, body)

    assert (again["accepted"], again["duplicates"]) == (0, 3)
    assert again["session_id"] == first["session_id"]
    assert again["progress"] == []
    after = await db_state(test_engine, user_id, words, first["session_id"])
    assert after == before


# --- Luật áp SRS (9.2) ---------------------------------------------------------------------------


async def test_session_early_correct_keeps_schedule_early_wrong_resets(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    early_ok = await seed.word(list_id, "early_ok", due=3 * DAY, interval=15)
    early_wrong = await seed.word(list_id, "early_wrong", due=3 * DAY, interval=15)
    before_ok = await progress_of(test_engine, early_ok)
    now = clock.current

    body = await post_ok(
        client,
        auth,
        session_body([answer(early_ok, now, q=5), answer(early_wrong, now, q=1)], now),
    )

    ok_after = await progress_of(test_engine, early_ok)
    assert snapshot(ok_after)[:6] == snapshot(before_ok)[:6]  # lịch giữ nguyên
    assert ok_after.correct_count == before_ok.correct_count + 1  # vẫn đếm đúng/sai

    wrong_after = await progress_of(test_engine, early_wrong)
    assert (wrong_after.interval_days, wrong_after.repetitions, wrong_after.lapses) == (1, 0, 1)
    assert wrong_after.wrong_count == 1
    assert wrong_after.due_at == local_midnight(local_today(TZ) + DAY)
    assert wrong_after.last_reviewed_at == now

    by_word = {item["word_id"]: item for item in body["progress"]}
    assert by_word[early_ok]["level"] == "familiar"
    assert by_word[early_wrong]["level"] == "learning"
    assert by_word[early_wrong]["interval_days"] == 1

    ok_log, wrong_log = await logs(test_engine)
    assert (ok_log.counted_for_srs, ok_log.interval_before, ok_log.interval_after) == (
        False,
        None,
        None,
    )
    assert (wrong_log.counted_for_srs, wrong_log.interval_before, wrong_log.interval_after) == (
        True,
        15,
        1,
    )


async def test_session_second_answer_same_word_in_request_is_not_first(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    word = await seed.word(list_id, "word")
    now = clock.current

    # App gửi sai luật: cả hai đều is_first_attempt = true
    body = await post_ok(
        client,
        auth,
        session_body(
            [answer(word, now, q=1), answer(word, now + timedelta(seconds=30), q=5)],
            now,
        ),
    )

    progress = await progress_of(test_engine, word)
    assert (progress.interval_days, progress.repetitions, progress.lapses) == (1, 0, 1)  # chỉ q=1
    assert progress.ease_factor == Decimal("1.96")
    assert (progress.correct_count, progress.wrong_count) == (1, 1)

    first_log, second_log = await logs(test_engine)
    assert (first_log.is_first_attempt, first_log.counted_for_srs) == (True, True)
    assert (second_log.is_first_attempt, second_log.counted_for_srs) == (False, False)

    today = (await daily(test_engine, user_id))[local_today(TZ)]
    assert (today.cards_done, today.correct, today.new_words) == (1, 0, 1)
    assert body["today"]["cards_done"] == 1
    study = await study_session(test_engine, body["session_id"])
    assert (study.total, study.correct) == (2, 1)  # phiên đếm cả câu hỏi lại
    assert [item["word_id"] for item in body["progress"]] == [word]


async def test_session_answer_in_later_batch_is_not_first(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    word = await seed.word(list_id, "word")
    now = clock.current
    session_id = str(uuid.uuid4())

    first = await post_ok(
        client, auth, session_body([answer(word, now, q=4)], now, session_id=session_id)
    )
    after_first = snapshot(await progress_of(test_engine, word))[:6]

    clock.advance(minutes=2)
    body = await post_ok(
        client,
        auth,
        session_body([answer(word, clock.current, q=1)], now, session_id=session_id),
    )

    assert (body["accepted"], body["duplicates"]) == (1, 0)
    assert snapshot(await progress_of(test_engine, word))[:6] == after_first
    later_log = (await logs(test_engine))[-1]
    assert (later_log.is_first_attempt, later_log.counted_for_srs) == (False, False)
    today = (await daily(test_engine, user_id))[local_today(TZ)]
    assert (today.cards_done, today.correct) == (1, 1)
    assert body["session_id"] == first["session_id"]
    study = await study_session(test_engine, body["session_id"])
    assert (study.total, study.correct) == (2, 1)


async def test_session_match_mode_does_not_apply_srs(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    word = await seed.word(list_id, "word", due=-DAY, interval=6)
    before = await progress_of(test_engine, word)
    now = clock.current

    await post_ok(client, auth, session_body([answer(word, now, q=1)], now, mode="match"))

    after = await progress_of(test_engine, word)
    assert snapshot(after)[:6] == snapshot(before)[:6]
    assert after.wrong_count == 1
    (log,) = await logs(test_engine)
    assert (log.mode, log.is_first_attempt, log.counted_for_srs) == ("match", True, False)
    today = (await daily(test_engine, user_id))[local_today(TZ)]
    assert (today.cards_done, today.new_words) == (1, 0)


@pytest.mark.parametrize(
    ("due", "interval", "first_q"),
    [
        (None, 0, 4),  # từ mới, đúng: mode khác sẽ áp SRS
        (None, 0, 1),  # từ mới, sai
        (-DAY, 6, 5),  # đến hạn, rất tốt
        (-DAY, 6, 1),  # đến hạn, sai
        (DAY, 6, 1),  # chưa đến hạn nhưng sai: mode khác vẫn áp SRS
        (DAY, 6, 4),  # chưa đến hạn, đúng
    ],
)
async def test_session_match_logs_always_not_counted_for_srs(
    client: AsyncClient,
    auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
    due: timedelta | None,
    interval: int,
    first_q: int,
) -> None:
    """Luật 3 ở 9.2: mọi log mode match có counted_for_srs = false, lịch ôn không đổi."""
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    list_id = await new_list(client, auth)
    word = await seed.word(list_id, "word", due=due, interval=interval)
    other = await seed.word(list_id, "other", due=due, interval=interval)
    before = {w: snapshot(await progress_of(test_engine, w))[:6] for w in (word, other)}
    now = clock.current
    session_id = str(uuid.uuid4())

    # Lô 1: lần nối đầu (first_q), nối sai rồi nối lại, và một từ khác nối đúng ngay.
    await post_ok(
        client,
        auth,
        session_body(
            [
                answer(word, now, q=first_q),
                answer(word, now, q=1, first=False),
                answer(word, now, q=4, first=False),
                answer(other, now, q=4),
            ],
            now,
            session_id=session_id,
            mode="match",
            list_id=list_id,
        ),
    )
    # Lô 2 (gửi sau, kết thúc phiên): app gửi nhầm is_first_attempt = true cũng không được áp.
    later = now + timedelta(minutes=1)
    clock.current = later
    body = await post_ok(
        client,
        auth,
        session_body(
            [answer(other, later, q=5)],
            now,
            session_id=session_id,
            mode="match",
            finished=True,
            ended_at=later,
            list_id=list_id,
        ),
    )

    all_logs = await logs(test_engine)
    assert len(all_logs) == 5
    assert all(log.mode == "match" for log in all_logs)
    assert [log.counted_for_srs for log in all_logs] == [False] * 5
    assert [(log.interval_before, log.interval_after) for log in all_logs] == [(None, None)] * 5
    assert [log.is_first_attempt for log in all_logs] == [True, False, False, True, False]
    for w in (word, other):
        assert snapshot(await progress_of(test_engine, w))[:6] == before[w]
    expected_wrong = 1 + int(first_q < 3)
    assert ((await progress_of(test_engine, word)).wrong_count) == expected_wrong
    assert ((await progress_of(test_engine, other)).correct_count) == 2
    assert {p["word_id"]: p["interval_days"] for p in body["progress"]} == {other: interval}


# --- Quyền và validate --------------------------------------------------------------------------


async def test_session_of_other_user_is_404(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
) -> None:
    seed = Seeder(test_engine, clock, auth["user"]["id"])
    word = await seed.word(await new_list(client, auth), "word")
    now = clock.current
    session_id = str(uuid.uuid4())
    await post_ok(client, other_auth, session_body([], now, session_id=session_id))

    response = await post(
        client, auth, session_body([answer(word, now)], now, session_id=session_id)
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    assert await logs(test_engine) == []


async def test_session_skips_words_of_other_user(
    client: AsyncClient,
    auth: dict[str, Any],
    other_auth: dict[str, Any],
    test_engine: AsyncEngine,
    clock: FakeClock,
) -> None:
    other_seed = Seeder(test_engine, clock, other_auth["user"]["id"])
    foreign = await other_seed.word(await new_list(client, other_auth), "foreign")
    before = snapshot(await progress_of(test_engine, foreign))
    now = clock.current

    body = await post_ok(client, auth, session_body([answer(foreign, now)], now))

    assert (body["accepted"], body["duplicates"], body["progress"]) == (0, 0, [])
    assert snapshot(await progress_of(test_engine, foreign)) == before
    assert await logs(test_engine) == []
    assert await daily(test_engine, other_auth["user"]["id"]) == {}


async def test_session_validation_and_auth(
    client: AsyncClient, auth: dict[str, Any], clock: FakeClock
) -> None:
    now = clock.current
    word = str(uuid.uuid4())
    bad_quality = session_body([answer(word, now, q=6)], now)
    assert (await post(client, auth, bad_quality)).status_code == 422
    bad_mode = session_body([], now, mode="karaoke")
    assert (await post(client, auth, bad_mode)).status_code == 422
    assert (await client.post(URL, json=session_body([], now))).status_code == 401


# --- daily_activity -----------------------------------------------------------------------------


async def test_session_finished_adds_study_seconds_once_capped(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    now = clock.current
    short_id, long_id = str(uuid.uuid4()), str(uuid.uuid4())

    started = now - timedelta(minutes=10)
    await post_ok(client, auth, session_body([], started, session_id=short_id))  # chưa kết thúc
    assert await daily(test_engine, user_id) == {}
    finished = session_body([], started, session_id=short_id, finished=True, ended_at=now)
    short_session = await post_ok(client, auth, finished)
    await post_ok(client, auth, finished)  # gửi lại: không cộng lần nữa
    long = session_body(
        [], now - timedelta(hours=3), session_id=long_id, finished=True, ended_at=now
    )
    await post_ok(client, auth, long)

    today = (await daily(test_engine, user_id))[local_today(TZ)]
    assert today.study_seconds == 10 * 60 + 2 * 60 * 60
    short = await study_session(test_engine, short_session["session_id"])
    assert short.ended_at == now


async def test_session_goal_met_and_streak(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    await set_settings(client, auth, daily_goal_cards=10)
    words = [await seed.word(list_id, f"w{i}") for i in range(10)]
    today = local_today(TZ)
    async with AsyncSession(test_engine) as session:
        for back, cards in ((1, 12), (2, 10), (4, 30)):  # ngày -3 bỏ trống → streak đứt ở đó
            session.add(
                DailyActivity(
                    user_id=uuid.UUID(user_id), activity_date=today - back * DAY, cards_done=cards
                )
            )
        await session.commit()
    now = clock.current

    nine = await post_ok(client, auth, session_body([answer(w, now) for w in words[:9]], now))
    assert nine["today"] == {"cards_done": 9, "goal": 10, "goal_met": False, "streak_current": 2}
    assert not (await daily(test_engine, user_id))[today].goal_met

    ten = await post_ok(client, auth, session_body([answer(words[9], now)], now))
    assert ten["today"] == {"cards_done": 10, "goal": 10, "goal_met": True, "streak_current": 3}
    assert (await daily(test_engine, user_id))[today].goal_met


async def test_session_daily_activity_uses_local_date_of_answer(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    late, early = await seed.word(list_id, "late"), await seed.word(list_id, "early")
    midnight = local_midnight(local_today(TZ))
    clock.set(midnight + timedelta(minutes=5))

    await post_ok(
        client,
        {"headers": {"Authorization": f"Bearer {create_access_token(uuid.UUID(user_id))[0]}"}},
        session_body(
            [
                answer(late, midnight - timedelta(minutes=1)),  # 23:59 hôm qua (giờ VN)
                answer(early, midnight + timedelta(minutes=1)),  # 00:01 hôm nay
            ],
            midnight - timedelta(minutes=10),
        ),
    )

    rows = await daily(test_engine, user_id)
    today = local_today(TZ)
    assert {d: r.cards_done for d, r in rows.items()} == {today - DAY: 1, today: 1}
    # due_at cũng theo ngày local của lúc trả lời
    assert (await progress_of(test_engine, late)).due_at == midnight
    assert (await progress_of(test_engine, early)).due_at == local_midnight(today + DAY)


# --- Mô phỏng 7 ngày -----------------------------------------------------------------------------

# Từ X, mỗi ngày trả lời 1 lần lúc 10:00 giờ VN. Tính tay theo 9.2:
# (ngày, q, EF, interval, reps, lapses, due = ngày D?, level, áp SRS?)
X_PLAN = [
    (0, 4, "2.50", 1, 1, 0, 1, "learning", True),  # từ mới
    (1, 4, "2.50", 6, 2, 0, 7, "learning", True),  # đến hạn D1
    (2, 5, "2.50", 6, 2, 0, 7, "learning", False),  # chưa đến hạn, đúng → giữ lịch
    (3, 1, "1.96", 1, 0, 1, 4, "learning", True),  # chưa đến hạn nhưng sai → áp
    (4, 3, "1.82", 1, 1, 1, 5, "learning", True),  # đến hạn D4
    (5, 4, "1.82", 6, 2, 1, 11, "learning", True),  # đến hạn D5
    (6, 5, "1.82", 6, 2, 1, 11, "learning", False),  # chưa đến hạn D11, đúng → giữ lịch
]
# Từ Y, ngày nào cũng q=5: D0 → I1 (hạn D1), D1 → I6 (hạn D7), D2–D6 học trước hạn → giữ nguyên.
Y_PLAN = [
    (0, "2.60", 1, 1, 1, True),
    (1, "2.70", 6, 2, 7, True),
    *[(day, "2.70", 6, 2, 7, False) for day in range(2, 7)],
]


async def test_session_seven_day_simulation_matches_hand_table(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    user_id = auth["user"]["id"]
    d0 = local_today(TZ)
    clock.set(local_midnight(d0) + timedelta(hours=10))
    seed = Seeder(test_engine, clock, user_id)
    list_id = await new_list(client, auth)
    x, y = await seed.word(list_id, "x"), await seed.word(list_id, "y")

    for (day, q, ef, interval, reps, lapses, due_day, level, applied), y_row in zip(
        X_PLAN, Y_PLAN, strict=True
    ):
        clock.set(local_midnight(d0 + day * DAY) + timedelta(hours=10))
        now = clock.current
        headers = {"Authorization": f"Bearer {create_access_token(uuid.UUID(user_id))[0]}"}
        body = await post_ok(
            client,
            {"headers": headers},
            session_body(
                [answer(x, now, q=q), answer(y, now + timedelta(seconds=5), q=5)],
                now - timedelta(minutes=1),
                finished=True,
                ended_at=now + timedelta(minutes=1),
            ),
        )

        expected_due = local_midnight(d0 + due_day * DAY)
        px = await progress_of(test_engine, x)
        assert (px.ease_factor, px.interval_days, px.repetitions, px.lapses) == (
            Decimal(ef),
            interval,
            reps,
            lapses,
        ), f"D{day}"
        assert px.due_at == expected_due, f"D{day}"
        progress_x = next(p for p in body["progress"] if p["word_id"] == x)
        assert progress_x["level"] == level
        assert progress_x["interval_days"] == interval
        assert datetime.fromisoformat(progress_x["due_at"]) == expected_due
        x_log = (await logs(test_engine, x))[-1]
        assert x_log.counted_for_srs is applied, f"D{day}"

        _, y_ef, y_interval, y_reps, y_due, y_applied = y_row
        py = await progress_of(test_engine, y)
        assert (py.ease_factor, py.interval_days, py.repetitions) == (
            Decimal(y_ef),
            y_interval,
            y_reps,
        ), f"D{day}"
        assert py.due_at == local_midnight(d0 + y_due * DAY)
        assert (await logs(test_engine, y))[-1].counted_for_srs is y_applied

        assert body["today"]["cards_done"] == 2

    rows = await daily(test_engine, user_id)
    assert sorted(rows) == [d0 + n * DAY for n in range(7)]
    assert [(rows[d0 + n * DAY].cards_done, rows[d0 + n * DAY].new_words) for n in range(7)] == [
        (2, 2),
        *[(2, 0)] * 6,
    ]
    assert all(row.study_seconds == 120 for row in rows.values())
    assert sum(log.counted_for_srs for log in await logs(test_engine, x)) == 5
    x_final = await progress_of(test_engine, x)
    assert (x_final.correct_count, x_final.wrong_count) == (6, 1)
