"""Chọn từ cho thông báo đẩy từ vựng (PLAN.md 9.9)."""

import uuid
from collections.abc import Collection
from datetime import datetime

from sqlalchemy import ColumnElement, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import UnaryExpression

from app.core.levels import FAMILIAR_MIN_INTERVAL
from app.models import Word, WordProgress
from app.repositories.word_repository import with_progress


async def pick(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    where: ColumnElement[bool] | None,
    order_by: Collection[ColumnElement[object] | UnaryExpression[object]],
    exclude_ids: Collection[uuid.UUID],
    limit: int,
) -> list[Word]:
    """Một nhóm ứng viên, bỏ các từ đã chọn ở nhóm trước."""
    if limit <= 0:
        return []
    query = with_progress(user_id)
    if where is not None:
        query = query.where(where)
    if exclude_ids:
        query = query.where(Word.id.not_in(exclude_ids))
    rows = await session.execute(query.order_by(*order_by).limit(limit))
    return [word for word, _ in rows]


def learning() -> ColumnElement[bool]:
    """Đang học: đã học (due_at khác null) và interval < 7 ngày."""
    return WordProgress.due_at.is_not(None) & (WordProgress.interval_days < FAMILIAR_MIN_INTERVAL)


def due_before(moment: datetime) -> ColumnElement[bool]:
    return WordProgress.due_at <= moment


def starred() -> ColumnElement[bool]:
    return Word.is_starred.is_(True)


def random_order() -> ColumnElement[object]:
    return func.random()
