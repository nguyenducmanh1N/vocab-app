"""Danh sách từ cho thông báo đẩy từ vựng (PLAN.md 9.9)."""

from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import now_utc
from app.models import User, Word, WordProgress
from app.repositories import notification_repository as repo
from app.schemas.notification import FeedItem, WordFeedOut

DUE_SOON_DAYS = 3


def _to_item(word: Word) -> FeedItem:
    example = word.examples[0] if word.examples else {}
    return FeedItem(
        word_id=word.id,
        term=word.term,
        part_of_speech=word.part_of_speech,
        meaning_vi=word.meaning_vi,
        example_en=example.get("en") or None,
        example_vi=example.get("vi") or None,
    )


async def word_feed(session: AsyncSession, user: User, days: int, per_day: int) -> WordFeedOut:
    """Ưu tiên: Đang học (theo due_at) → đến hạn trong 3 ngày → gắn sao → ngẫu nhiên; bỏ trùng."""
    total = days * per_day
    now = now_utc()
    groups = [
        (repo.learning(), [WordProgress.due_at, Word.id]),
        (repo.due_before(now + timedelta(days=DUE_SOON_DAYS)), [WordProgress.due_at, Word.id]),
        (repo.starred(), [Word.created_at, Word.id]),
        (None, [repo.random_order()]),
    ]
    picked: list[Word] = []
    for where, order_by in groups:
        picked += await repo.pick(
            session,
            user.id,
            where=where,
            order_by=order_by,
            exclude_ids={word.id for word in picked},
            limit=total - len(picked),
        )
    return WordFeedOut(items=[_to_item(word) for word in picked])
