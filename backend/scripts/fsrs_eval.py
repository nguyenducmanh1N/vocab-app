"""Đánh giá chuyển lịch ôn SM-2 sang FSRS (P6.4, PLAN.md 9.2). Chỉ đọc DB, không sửa gì.

`fsrs` không nằm trong pyproject (chưa dùng trong app), nên cài tạm khi chạy:

    cd backend && uv run --with fsrs==6.3.2 python scripts/fsrs_eval.py db
    cd backend && uv run --with fsrs==6.3.2 python scripts/fsrs_eval.py sim --runs 50 --seed 1

- db: replay review_logs thật bằng SM-2 (code của app) và FSRS, đối chiếu SM-2 với word_progress,
  so R dự đoán với đúng/sai thật, rồi mô phỏng `--days` ngày tới với các từ đang có.
- sim: người học giả lập 90 ngày (10 từ mới/ngày, tối đa 100 lượt ôn/ngày), 2 mô hình trí nhớ.

Cách so cho công bằng với app:
- Chỉ dùng lượt có counted_for_srs (luật 9.2 đã chọn để cập nhật lịch).
- q 0–2 → Again, 3 → Hard, 4 → Good, 5 → Easy.
- FSRS không có learning/relearning step, không fuzz; khoảng ôn tính theo ngày rồi đặt due bằng
  due_at_after() của app (00:00 theo giờ local), như SM-2. Giờ ôn đưa cho FSRS là 12:00 ngày local
  (FSRS đếm ngày theo đủ 24 giờ, app đếm theo ngày lịch).
"""

import argparse
import asyncio
import math
import random
import statistics
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fsrs import Card, Rating, Scheduler
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.time import start_of_local_day  # noqa: E402
from app.services.srs import SrsState, due_at_after, sm2  # noqa: E402

RATING_OF_Q = {
    0: Rating.Again,
    1: Rating.Again,
    2: Rating.Again,
    3: Rating.Hard,
    4: Rating.Good,
    5: Rating.Easy,
}
OPTIMIZER_MIN_REVIEWS = 1000  # dưới mức này tối ưu tham số FSRS chưa đáng tin

# Đo trên DB dev ngày 16/10/2026: lần trả lời đầu của từ mới đúng 73%; khi đúng, q3/q4/q5.
P_FIRST_CORRECT = 0.73
CORRECT_Q_WEIGHTS = {3: 0.07, 4: 0.91, 5: 0.02}


def new_scheduler() -> Scheduler:
    return Scheduler(learning_steps=(), relearning_steps=(), enable_fuzzing=False)


DEFAULT = new_scheduler()
DECAY = -DEFAULT.parameters[20]
FACTOR = 0.9 ** (1 / DECAY) - 1


def forgetting_curve(elapsed_days: float, stability: float) -> float:
    """Đường quên FSRS-6 (giống Scheduler.get_card_retrievability)."""
    return (1 + FACTOR * max(0.0, elapsed_days) / stability) ** DECAY


# --- Hai lịch ôn ---


class Sm2Plan:
    name = "SM-2"

    def __init__(self) -> None:
        self.states: dict[Any, SrsState] = {}

    def review(self, word: Any, q: int, at: datetime) -> int:
        state = sm2(self.states.get(word, SrsState()), q)
        self.states[word] = state
        return state.interval_days


class FsrsPlan:
    name = "FSRS-6"

    def __init__(self) -> None:
        self.cards: dict[Any, Card] = {}

    def review(self, word: Any, q: int, at: datetime) -> int:
        card, _ = DEFAULT.review_card(self.cards.get(word) or Card(), RATING_OF_Q[q], at)
        self.cards[word] = card
        return max(1, round((card.due - at).total_seconds() / 86400))

    def retrievability(self, word: Any, at: datetime) -> float | None:
        card = self.cards.get(word)
        return DEFAULT.get_card_retrievability(card, at) if card else None


PLANS: dict[str, Callable[[], Sm2Plan | FsrsPlan]] = {"SM-2": Sm2Plan, "FSRS-6": FsrsPlan}


# --- Hai mô hình "trí nhớ thật" của người học giả lập ---


class FsrsTruth:
    """(A) Đường quên FSRS-6; mỗi từ có hệ số khó riêng k mà lịch ôn không biết. Thiên về FSRS."""

    name = "A: FSRS-6 + độ khó riêng"

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.cards: dict[Any, Card] = {}
        self.k: dict[Any, float] = {}

    def seed(self, word: Any, card: Card) -> None:
        self.cards[word] = card

    def recall(self, word: Any, at: datetime) -> float:
        card = self.cards.get(word)
        if card is None:
            return P_FIRST_CORRECT
        k = self.k.setdefault(word, math.exp(self.rng.gauss(0, 0.5)))
        return forgetting_curve((at - card.last_review).days, card.stability * k)

    def update(self, word: Any, success: bool, at: datetime) -> None:
        rating = Rating.Good if success else Rating.Again
        self.cards[word], _ = DEFAULT.review_card(self.cards.get(word) or Card(), rating, at)


class ExpTruth:
    """(B) Mô hình mũ độc lập với FSRS: R = e^(−t/S); nhớ thì S × g (1,5–3), quên thì S về S0."""

    name = "B: mũ đơn giản"

    def __init__(self, rng: random.Random) -> None:
        self.rng = rng
        self.state: dict[Any, tuple[float, float, float, datetime]] = {}  # S0, g, S, lần cuối

    def seed(self, word: Any, card: Card) -> None:
        s0 = math.exp(self.rng.gauss(math.log(2), 0.5))
        self.state[word] = (s0, self.rng.uniform(1.5, 3.0), card.stability, card.last_review)

    def recall(self, word: Any, at: datetime) -> float:
        if word not in self.state:
            return P_FIRST_CORRECT
        _, _, s, last = self.state[word]
        return math.exp(-((at - last).days) / s)

    def update(self, word: Any, success: bool, at: datetime) -> None:
        if word not in self.state:
            s0 = math.exp(self.rng.gauss(math.log(2), 0.5))
            g = self.rng.uniform(1.5, 3.0)
            self.state[word] = (s0, g, s0 if success else s0 / 2, at)
            return
        s0, g, s, _ = self.state[word]
        self.state[word] = (s0, g, s * g if success else s0, at)


TRUTHS: dict[str, Callable[[random.Random], FsrsTruth | ExpTruth]] = {
    "A": FsrsTruth,
    "B": ExpTruth,
}


# --- Mô phỏng ---


@dataclass
class RunResult:
    per_day: list[int] = field(default_factory=list)  # lượt ôn đến hạn mỗi ngày (không gồm từ mới)
    successes: int = 0
    predicted: list[float] = field(default_factory=list)  # R FSRS dự đoán lúc ôn
    retained: float = 0.0  # tổng R thật của mọi từ ở cuối
    backlog: int = 0  # thẻ quá hạn chưa ôn ở cuối


def sample_q(rng: random.Random, success: bool) -> int:
    if not success:
        return 1
    return rng.choices(list(CORRECT_Q_WEIGHTS), weights=list(CORRECT_Q_WEIGHTS.values()))[0]


def simulate(
    plan: Sm2Plan | FsrsPlan,
    truth: FsrsTruth | ExpTruth,
    rng: random.Random,
    *,
    days: int,
    review_times: list[datetime],
    tz: str,
    due: dict[Any, datetime],
    new_per_day: int,
    max_reviews: int,
    predictor: FsrsPlan,
) -> RunResult:
    result = RunResult()
    words = set(due)
    next_new = 0

    def answer(word: Any, at: datetime, *, is_new: bool) -> None:
        success = rng.random() < truth.recall(word, at)
        q = sample_q(rng, success)
        if not is_new:
            result.successes += success
            predicted = predictor.retrievability(word, at)
            if predicted is not None:
                result.predicted.append(predicted)
        if predictor is not plan:
            predictor.review(word, q, at)
        truth.update(word, success, at)
        due[word] = due_at_after(at, plan.review(word, q, at), tz)

    for day in range(days):
        at = review_times[day]
        ready = sorted((t, str(w), w) for w, t in due.items() if t <= at)[:max_reviews]
        for _, _, word in ready:
            answer(word, at, is_new=False)
        for _ in range(new_per_day):
            word = f"new-{next_new}"
            next_new += 1
            words.add(word)
            answer(word, at, is_new=True)
        result.per_day.append(len(ready))

    end = review_times[days]
    result.retained = sum(truth.recall(w, end) for w in words)
    result.backlog = sum(1 for t in due.values() if t <= end)
    return result


def summarize(results: list[RunResult]) -> dict[str, float]:
    reviews = [sum(r.per_day) for r in results]
    per_day = [statistics.fmean(r.per_day) for r in results]
    p90 = [sorted(r.per_day)[int(0.9 * (len(r.per_day) - 1))] for r in results]
    peak = [max(r.per_day) for r in results]
    recall = [r.successes / max(1, sum(r.per_day)) for r in results]
    predicted = [statistics.fmean(r.predicted) for r in results if r.predicted]
    retained = [r.retained for r in results]
    return {
        "mean/day": statistics.fmean(per_day),
        "p90/day": statistics.fmean(p90),
        "peak/day": statistics.fmean(peak),
        "total": statistics.fmean(reviews),
        "recall": statistics.fmean(recall),
        "predicted": statistics.fmean(predicted) if predicted else float("nan"),
        "retained": statistics.fmean(retained),
        "per100": statistics.fmean(
            100 * r / max(1, n) for r, n in zip(retained, reviews, strict=True)
        ),
        "backlog": statistics.fmean(r.backlog for r in results),
    }


def print_table(rows: list[tuple[str, str, dict[str, float]]], unit: str) -> None:
    print(
        "| Trí nhớ | Lịch | Lượt ôn/ngày (TB · p90 · đỉnh) | Tổng lượt ôn | Nhớ thật lúc ôn "
        f"| R FSRS dự đoán lúc ôn | {unit} | Từ nhớ / 100 lượt | Quá hạn cuối kỳ |"
    )
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for truth, plan, s in rows:
        print(
            f"| {truth} | {plan} | {s['mean/day']:.1f} · {s['p90/day']:.0f} · {s['peak/day']:.0f} "
            f"| {s['total']:.0f} | {s['recall']:.1%} | {s['predicted']:.1%} "
            f"| {s['retained']:.1f} | {s['per100']:.1f} | {s['backlog']:.1f} |"
        )


# --- Chế độ sim ---


def run_sim(args: argparse.Namespace) -> None:
    start = datetime(2026, 1, 5, 12, tzinfo=UTC)
    times = [start + timedelta(days=d) for d in range(args.days + 1)]
    print(f"## Giả lập {args.days} ngày · {args.runs} lần · seed {args.seed}\n")
    print(
        f"10 từ mới/ngày, tối đa 100 lượt ôn/ngày; lần đầu đúng {P_FIRST_CORRECT:.0%}; "
        "R dự đoán tính bằng FSRS-6 tham số mặc định cho cả hai lịch.\n"
    )
    rows = []
    for truth_key, truth_cls in TRUTHS.items():
        for plan_name, plan_cls in PLANS.items():
            results = []
            for run in range(args.runs):
                rng = random.Random(f"{args.seed}-{truth_key}-{run}")  # cùng seed cho 2 lịch
                plan = plan_cls()
                predictor = plan if isinstance(plan, FsrsPlan) else FsrsPlan()
                results.append(
                    simulate(
                        plan,
                        truth_cls(rng),
                        rng,
                        days=args.days,
                        review_times=times,
                        tz="UTC",
                        due={},
                        new_per_day=10,
                        max_reviews=100,
                        predictor=predictor,
                    )
                )
            rows.append((truth_cls.name, plan_name, summarize(results)))
    print_table(rows, f"Từ còn nhớ ngày {args.days} (/{10 * args.days})")


# --- Chế độ db ---


async def load(database_url: str) -> tuple[list[Any], list[Any]]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as conn:
            logs = (
                await conn.execute(
                    text(
                        "SELECT l.user_id, l.word_id, l.quality, l.is_correct, l.reviewed_at, "
                        "u.timezone FROM review_logs l JOIN users u ON u.id = l.user_id "
                        "WHERE l.counted_for_srs ORDER BY l.reviewed_at, l.id"
                    )
                )
            ).all()
            progress = (
                await conn.execute(
                    text(
                        "SELECT word_id, ease_factor, interval_days, repetitions, lapses, due_at "
                        "FROM word_progress WHERE due_at IS NOT NULL"
                    )
                )
            ).all()
    finally:
        await engine.dispose()
    return logs, progress


def run_db(args: argparse.Namespace) -> None:
    logs, progress = asyncio.run(load(get_settings().database_url))
    users = {row.user_id for row in logs}
    print(f"## Dữ liệu thật · {len(logs)} lượt counted_for_srs · {len(users)} user\n")
    if not logs:
        print("Không có review_logs nào để phân tích.")
        return
    first, last = logs[0].reviewed_at, logs[-1].reviewed_at
    print(f"- Từ {first:%d/%m/%Y} đến {last:%d/%m/%Y}; {len({r.word_id for r in logs})} từ.")
    print(
        f"- Tối ưu tham số FSRS cần khoảng {OPTIMIZER_MIN_REVIEWS} lượt: còn thiếu "
        f"{max(0, OPTIMIZER_MIN_REVIEWS - len(logs))}. Dùng tham số mặc định.\n"
    )

    # Replay
    tz_of: dict[Any, str] = {}
    sm2_plan, fsrs_plan = Sm2Plan(), FsrsPlan()
    sm2_due: dict[Any, datetime] = {}
    fsrs_due: dict[Any, datetime] = {}
    calibration: list[tuple[float, bool]] = []
    for row in logs:
        word, at, tz = row.word_id, row.reviewed_at, row.timezone
        tz_of[word] = tz
        # FSRS đếm ngày bằng timedelta.days (đủ 24 giờ); app đếm theo ngày local. Đưa giờ ôn về
        # 12:00 ngày local để 20:00 hôm trước → 08:00 hôm sau tính là 1 ngày như trong app.
        day_at = start_of_local_day(at.astimezone(ZoneInfo(tz)).date(), tz) + timedelta(hours=12)
        card = fsrs_plan.cards.get(word)
        if card is not None and (day_at - card.last_review).days >= 1:
            calibration.append((DEFAULT.get_card_retrievability(card, day_at), row.is_correct))
        sm2_due[word] = due_at_after(at, sm2_plan.review(word, row.quality, at), tz)
        fsrs_due[word] = due_at_after(at, fsrs_plan.review(word, row.quality, day_at), tz)

    # Đối chiếu SM-2 replay với word_progress
    mismatches = []
    for p in progress:
        state = sm2_plan.states.get(p.word_id)
        expected = (float(p.ease_factor), p.interval_days, p.repetitions, p.lapses, p.due_at)
        got = state and (
            state.ease_factor,
            state.interval_days,
            state.repetitions,
            state.lapses,
            sm2_due[p.word_id],
        )
        if got != expected:
            mismatches.append((p.word_id, expected, got))
    print(
        f"### Đối chiếu SM-2 replay với word_progress: "
        f"{len(progress) - len(mismatches)}/{len(progress)} khớp\n"
    )
    for word, expected, got in mismatches[:5]:
        print(f"- {word}: DB {expected} ≠ replay {got}")

    # Ngày tới hạn kế tiếp, theo ngày local của user
    now = datetime.now(UTC)
    zone = ZoneInfo(next(iter(tz_of.values())))
    today = now.astimezone(zone).date()
    print("\n### Ngày tới hạn kế tiếp của từng từ\n")
    print("| Lịch | Hôm nay hoặc quá hạn | Ngày mai | 2–7 ngày nữa | Sau 7 ngày |")
    print("| --- | --- | --- | --- | --- |")
    for name, due in (("SM-2", sm2_due), ("FSRS-6", fsrs_due)):
        buckets = [0, 0, 0, 0]
        for t in due.values():
            d = (t.astimezone(zone).date() - today).days
            buckets[0 if d <= 0 else 1 if d == 1 else 2 if d <= 7 else 3] += 1
        print(f"| {name} | " + " | ".join(map(str, buckets)) + " |")

    # Hiệu chỉnh R dự đoán trên log thật
    print("\n### R FSRS dự đoán so với kết quả thật (lượt ôn cách lượt trước ≥ 1 ngày)\n")
    if calibration:
        mean_r = statistics.fmean(r for r, _ in calibration)
        actual = statistics.fmean(ok for _, ok in calibration)
        clipped = [(min(max(r, 1e-6), 1 - 1e-6), ok) for r, ok in calibration]
        logloss = -statistics.fmean(math.log(r if ok else 1 - r) for r, ok in clipped)
        print(
            f"n = {len(calibration)} · R dự đoán TB {mean_r:.1%} · đúng thật {actual:.1%} "
            f"· log-loss {logloss:.3f} (đoán 50/50 là 0,693)"
        )
    else:
        print("Chưa có lượt ôn nào cách lượt trước từ 1 ngày trở lên.")

    # Mô phỏng các ngày tới với các từ đang có (không thêm từ mới)
    tz = zone.key
    times = [
        start_of_local_day(today + timedelta(days=d), tz) + timedelta(hours=12)
        for d in range(args.days + 1)
    ]
    print(
        f"\n### {args.days} ngày tới với {len(fsrs_plan.cards)} từ đang có "
        f"(không thêm từ mới, {args.runs} lần)\n"
    )
    rows = []
    per_day_rows: dict[str, list[float]] = {}
    for truth_key, truth_cls in TRUTHS.items():
        for plan_name in PLANS:
            results = []
            for run in range(args.runs):
                rng = random.Random(f"{args.seed}-db-{truth_key}-{run}")
                truth = truth_cls(rng)
                for word, card in fsrs_plan.cards.items():
                    truth.seed(word, card)
                plan: Sm2Plan | FsrsPlan
                if plan_name == "SM-2":
                    plan = Sm2Plan()
                    plan.states = dict(sm2_plan.states)
                    due = dict(sm2_due)
                    predictor = FsrsPlan()
                    predictor.cards = dict(fsrs_plan.cards)
                else:
                    plan = FsrsPlan()
                    plan.cards = dict(fsrs_plan.cards)
                    due = dict(fsrs_due)
                    predictor = plan
                results.append(
                    simulate(
                        plan,
                        truth,
                        rng,
                        days=args.days,
                        review_times=times,
                        tz=tz,
                        due=due,
                        new_per_day=0,
                        max_reviews=100,
                        predictor=predictor,
                    )
                )
            rows.append((truth_cls.name, plan_name, summarize(results)))
            if truth_key == "A":
                per_day_rows[plan_name] = [
                    statistics.fmean(r.per_day[d] for r in results) for d in range(args.days)
                ]
    print_table(rows, f"Từ còn nhớ ngày {args.days} (/{len(fsrs_plan.cards)})")
    print("\nLượt ôn mỗi ngày (mô hình A, trung bình), 14 ngày đầu:\n")
    print("| Lịch | " + " | ".join(f"N{d + 1}" for d in range(14)) + " |")
    print("| --- |" + " --- |" * 14)
    for name, values in per_day_rows.items():
        print(f"| {name} | " + " | ".join(f"{v:.1f}" for v in values[:14]) + " |")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("mode", choices=["db", "sim"])
    parser.add_argument("--days", type=int, default=None, help="db: 30, sim: 90")
    parser.add_argument("--runs", type=int, default=50)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    if args.days is None:
        args.days = 30 if args.mode == "db" else 90
    if args.mode == "db":
        run_db(args)
    else:
        run_sim(args)


if __name__ == "__main__":
    main()
