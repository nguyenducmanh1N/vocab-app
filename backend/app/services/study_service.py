"""Phiên học: chọn thẻ (PLAN.md 9.3) và ghi nhận kết quả (9.4)."""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.time import local_today, now_utc, start_of_local_day
from app.models import User, Word, WordProgress
from app.repositories import study_repository as repo
from app.repositories import word_list_repository as list_repo
from app.schemas.study import (
    AnswerIn,
    DistractorOut,
    ProgressBrief,
    QueueStats,
    SessionIn,
    SessionOut,
    StudyCard,
    StudyQueueOut,
    StudyQueueParams,
    TodayOut,
)
from app.schemas.user import UserSettings
from app.services.srs import due_at_after, level_of, sm2, state_of
from app.services.streak import STREAK_MIN_CARDS, STREAK_WINDOW_DAYS, compute_streaks
from app.services.word_service import to_word_out

NEW_EVERY = 4  # sau mỗi 4 thẻ ôn chèn 1 thẻ mới
DISTRACTOR_LIMIT = 30

Rows = list[tuple[Word, WordProgress]]


def interleave[T](due: Sequence[T], new: Sequence[T], every: int = NEW_EVERY) -> list[T]:
    """Sau mỗi `every` thẻ ôn chèn 1 thẻ mới; bên nào còn dư thì nối vào cuối."""
    mixed: list[T] = []
    remaining_new = list(new)
    for i, card in enumerate(due, start=1):
        mixed.append(card)
        if i % every == 0 and remaining_new:
            mixed.append(remaining_new.pop(0))
    return mixed + remaining_new


async def _review_today(
    session: AsyncSession, user: User, params: StudyQueueParams, now: datetime
) -> tuple[Rows, QueueStats]:
    """Ôn tập hôm nay: toàn kho, có hạn mức ôn và hạn mức từ mới theo ngày local."""
    settings = UserSettings.model_validate(user.settings)
    today = local_today(user.timezone)
    start = start_of_local_day(today, user.timezone)
    end = start_of_local_day(today + timedelta(days=1), user.timezone)

    due_quota = max(
        0, settings.max_reviews_per_day - await repo.reviews_done(session, user.id, start, end)
    )
    new_today = await repo.new_words_on(session, user.id, today)
    new_quota = max(0, settings.daily_new_words - new_today) + params.extra_new

    scope = {"list_id": None, "starred_only": params.starred_only}
    due = await repo.due_words(session, user.id, now, limit=min(due_quota, params.limit), **scope)
    new = await repo.new_words(session, user.id, limit=min(new_quota, params.limit), **scope)
    due_total, new_total = await repo.count_due_and_new(session, user.id, now, **scope)

    cards = interleave(due, new)[: params.limit]
    return cards, QueueStats(due_total=due_total, new_available=min(new_total, new_quota))


async def _by_list(
    session: AsyncSession,
    user: User,
    list_id: uuid.UUID,
    params: StudyQueueParams,
    now: datetime,
) -> tuple[Rows, QueueStats]:
    """Học theo list: đến hạn → mới → còn lại; không áp hạn mức theo ngày."""
    if await list_repo.get(session, user.id, list_id) is None:
        raise AppError(404, "NOT_FOUND", "Không tìm thấy list")

    scope = {"list_id": list_id, "starred_only": params.starred_only}
    cards = await repo.due_words(session, user.id, now, limit=params.limit, **scope)
    cards += await repo.new_words(session, user.id, limit=params.limit - len(cards), **scope)
    cards += await repo.other_words(session, user.id, now, limit=params.limit - len(cards), **scope)
    due_total, new_total = await repo.count_due_and_new(session, user.id, now, **scope)
    return cards, QueueStats(due_total=due_total, new_available=new_total)


def _to_card(word: Word, progress: WordProgress, now: datetime) -> StudyCard:
    due_at = progress.due_at
    return StudyCard(
        **to_word_out(word, progress).model_dump(),
        is_new=due_at is None,
        is_due=due_at is not None and due_at <= now,
    )


async def get_queue(session: AsyncSession, user: User, params: StudyQueueParams) -> StudyQueueOut:
    now = now_utc()
    if params.list_id is None:
        rows, stats = await _review_today(session, user, params, now)
    else:
        rows, stats = await _by_list(session, user, params.list_id, params, now)

    words = [word for word, _ in rows]
    pool = await repo.distractors(
        session,
        user.id,
        prefer_list_ids={word.list_id for word in words}
        if params.list_id is None
        else {params.list_id},
        exclude_ids={word.id for word in words},
        exclude_terms={word.term.lower() for word in words},
        limit=DISTRACTOR_LIMIT,
    )
    return StudyQueueOut(
        cards=[_to_card(word, progress, now) for word, progress in rows],
        distractor_pool=[
            DistractorOut(
                word_id=w.id, term=w.term, meaning_vi=w.meaning_vi, part_of_speech=w.part_of_speech
            )
            for w in pool
        ],
        stats=stats,
    )


# --- POST /study/sessions (9.4) ----------------------------------------------------------------

MAX_STUDY_SECONDS = 2 * 60 * 60  # một phiên tính tối đa 2 giờ vào study_seconds


@dataclass
class _DayTotals:
    cards_done: int = 0
    correct: int = 0
    new_words: int = 0
    study_seconds: int = 0


def _local_date(at: datetime, tz: str) -> date:
    return at.astimezone(ZoneInfo(tz)).date()


def _should_apply_srs(progress: WordProgress, answer: AnswerIn, *, first: bool, mode: str) -> bool:
    """Luật 3 ở 9.2: chỉ lần chấm đầu, khác match; chưa đến hạn thì chỉ áp khi trả lời sai."""
    if not first or mode == "match":
        return False
    due_at = progress.due_at
    return due_at is None or due_at <= answer.answered_at or answer.quality < 3


def _apply_srs(progress: WordProgress, answer: AnswerIn, tz: str) -> None:
    """Luật 4 ở 9.2."""
    state = sm2(state_of(progress), answer.quality)
    progress.ease_factor = Decimal(str(state.ease_factor))
    progress.interval_days = state.interval_days
    progress.repetitions = state.repetitions
    progress.lapses = state.lapses
    progress.due_at = due_at_after(answer.answered_at, state.interval_days, tz)
    progress.last_reviewed_at = answer.answered_at


async def _list_or_none(
    session: AsyncSession, user_id: uuid.UUID, list_id: uuid.UUID | None
) -> uuid.UUID | None:
    """List đã xoá hoặc không phải của user → lưu null, để lô gửi lại của app không bị kẹt."""
    if list_id is None or await list_repo.get(session, user_id, list_id) is None:
        return None
    return list_id


async def record_session(session: AsyncSession, user: User, data: SessionIn) -> SessionOut:
    """Ghi nhận kết quả phiên học trong một transaction; gửi lại nhiều lần không ghi trùng."""
    tz = user.timezone
    settings = UserSettings.model_validate(user.settings)

    study = await repo.get_or_create_session(
        session,
        user_id=user.id,
        client_session_id=data.client_session_id,
        list_id=await _list_or_none(session, user.id, data.list_id),
        mode=data.mode,
        started_at=data.started_at,
    )
    if study.user_id != user.id:
        raise AppError(404, "NOT_FOUND", "Không tìm thấy phiên học")

    accepted = duplicates = 0
    days: defaultdict[date, _DayTotals] = defaultdict(_DayTotals)
    touched: dict[uuid.UUID, WordProgress] = {}  # giữ thứ tự xuất hiện

    for answer in data.answers:
        progress = await repo.lock_progress(session, user.id, answer.word_id)
        if progress is None:  # từ không thuộc user hoặc đã bị xoá: bỏ qua
            continue
        # Kiểm tra trước khi ghi log của chính answer này (9.4 bước 3).
        first = answer.is_first_attempt and not await repo.has_other_log(
            session, study.id, answer.word_id, answer.client_answer_id
        )
        log_id = await repo.insert_log(
            session,
            {
                "user_id": user.id,
                "word_id": answer.word_id,
                "session_id": study.id,
                "client_answer_id": answer.client_answer_id,
                "mode": study.mode,
                "quality": answer.quality,
                "is_correct": answer.is_correct,
                "is_first_attempt": first,
                "counted_for_srs": False,
                "response_ms": answer.response_ms,
                "reviewed_at": answer.answered_at,
            },
        )
        if log_id is None:
            duplicates += 1
            continue
        accepted += 1

        was_new = progress.due_at is None
        if answer.is_correct:
            progress.correct_count += 1
        else:
            progress.wrong_count += 1
        applied = _should_apply_srs(progress, answer, first=first, mode=study.mode)
        if applied:
            interval_before = progress.interval_days
            _apply_srs(progress, answer, tz)
            await repo.mark_log_counted(session, log_id, interval_before, progress.interval_days)
        touched[answer.word_id] = progress

        study.total += 1
        study.correct += int(answer.is_correct)
        if first:  # câu hỏi lại không đẩy số thẻ và mục tiêu ngày lên
            day = days[_local_date(answer.answered_at, tz)]
            day.cards_done += 1
            day.correct += int(answer.is_correct)
            day.new_words += int(was_new and applied)

    if data.finished and study.ended_at is None:  # gửi lại finished không cộng giờ học lần nữa
        ended_at = data.ended_at or now_utc()
        study.ended_at = ended_at
        seconds = int((ended_at - study.started_at).total_seconds())
        days[_local_date(ended_at, tz)].study_seconds += min(max(seconds, 0), MAX_STUDY_SECONDS)

    for day, totals in days.items():
        await repo.add_daily(session, user.id, day, **asdict(totals))
    await repo.refresh_goal_met(session, user.id, list(days), settings.daily_goal_cards)
    await session.flush()

    today = local_today(tz)
    cards_today = await repo.cards_done_on(session, user.id, today)
    active = await repo.active_days(
        session, user.id, today - timedelta(days=STREAK_WINDOW_DAYS - 1), STREAK_MIN_CARDS
    )
    out = SessionOut(
        session_id=study.id,
        accepted=accepted,
        duplicates=duplicates,
        progress=[
            ProgressBrief(
                word_id=word_id,
                level=level_of(progress),
                due_at=progress.due_at,
                interval_days=progress.interval_days,
            )
            for word_id, progress in touched.items()
        ],
        today=TodayOut(
            cards_done=cards_today,
            goal=settings.daily_goal_cards,
            goal_met=cards_today >= settings.daily_goal_cards,
            streak_current=compute_streaks(active, today)[0],
        ),
    )
    await session.commit()
    return out
