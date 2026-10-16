import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiGeneration, Word


async def count_used(session: AsyncSession, user_id: uuid.UUID, kind: str, since: datetime) -> int:
    """Số lượt đã dùng: status = 'ok', không tính dòng lấy từ cache (PLAN.md 9.7 bước 2).

    Luyện nói chỉ tính lần có chấm: bỏ lần không nghe rõ hoặc đọc câu khác (9.11).
    """
    query = select(func.count()).where(
        AiGeneration.user_id == user_id,
        AiGeneration.kind == kind,
        AiGeneration.status == "ok",
        AiGeneration.model != "cache",
        AiGeneration.created_at >= since,
    )
    if kind == "speaking":
        query = query.where(AiGeneration.result["status"].astext == "ok")
    return await session.scalar(query) or 0


async def add(session: AsyncSession, generation: AiGeneration) -> AiGeneration:
    session.add(generation)
    await session.flush()
    return generation


async def saved_terms(
    session: AsyncSession, user_id: uuid.UUID, terms_lower: Sequence[str]
) -> set[str]:
    """Các term (viết thường) đã có trong words của user, để tính already_saved."""
    if not terms_lower:
        return set()
    rows = await session.scalars(
        select(func.lower(Word.term)).where(
            Word.user_id == user_id, func.lower(Word.term).in_(terms_lower)
        )
    )
    return set(rows)


async def find_cached(
    session: AsyncSession, cache_key: str, since: datetime
) -> AiGeneration | None:
    """Kết quả gợi ý gốc (không phải dòng 'cache') mới nhất cùng cache_key trong khoảng cache.

    Cố ý không lọc user_id: cache dùng chung giữa mọi user để tiết kiệm lượt Gemini (mục 15).
    Kết quả gợi ý không chứa dữ liệu riêng của ai (already_saved tính lại theo từng user).
    """
    return await session.scalar(
        select(AiGeneration)
        .where(
            AiGeneration.kind == "suggest",
            AiGeneration.status == "ok",
            AiGeneration.model != "cache",
            AiGeneration.cache_key == cache_key,
            AiGeneration.created_at >= since,
        )
        .order_by(AiGeneration.created_at.desc())
        .limit(1)
    )


def _history_filter(user_id: uuid.UUID) -> tuple[Any, ...]:
    """Chỉ lượt gợi ý thành công của chính user, bỏ dòng lấy từ cache (PLAN.md 8.3)."""
    return (
        AiGeneration.user_id == user_id,
        AiGeneration.kind == "suggest",
        AiGeneration.status == "ok",
        AiGeneration.model != "cache",
    )


async def list_history(session: AsyncSession, user_id: uuid.UUID, limit: int) -> list[AiGeneration]:
    rows = await session.scalars(
        select(AiGeneration)
        .where(*_history_filter(user_id))
        .order_by(AiGeneration.created_at.desc())
        .limit(limit)
    )
    return list(rows)


async def get_history(
    session: AsyncSession, user_id: uuid.UUID, generation_id: uuid.UUID
) -> AiGeneration | None:
    return await session.scalar(
        select(AiGeneration).where(AiGeneration.id == generation_id, *_history_filter(user_id))
    )
