import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PasswordResetCode


async def add(session: AsyncSession, code: PasswordResetCode) -> PasswordResetCode:
    session.add(code)
    await session.flush()
    return code


async def latest_unused_for_update(
    session: AsyncSession, user_id: uuid.UUID
) -> PasswordResetCode | None:
    """Mã chưa dùng mới nhất (mỗi user chỉ có một); khoá dòng để đếm số lần thử không bị sai."""
    return await session.scalar(
        select(PasswordResetCode)
        .where(PasswordResetCode.user_id == user_id, PasswordResetCode.used_at.is_(None))
        .order_by(PasswordResetCode.created_at.desc())
        .limit(1)
        .with_for_update()
    )


async def latest_created_at(session: AsyncSession, user_id: uuid.UUID) -> datetime | None:
    return await session.scalar(
        select(func.max(PasswordResetCode.created_at)).where(PasswordResetCode.user_id == user_id)
    )


async def count_since(session: AsyncSession, user_id: uuid.UUID, since: datetime) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(PasswordResetCode)
        .where(PasswordResetCode.user_id == user_id, PasswordResetCode.created_at > since)
    )
    return count or 0


async def invalidate_all(session: AsyncSession, user_id: uuid.UUID, at: datetime) -> None:
    await session.execute(
        update(PasswordResetCode)
        .where(PasswordResetCode.user_id == user_id, PasswordResetCode.used_at.is_(None))
        .values(used_at=at)
    )
