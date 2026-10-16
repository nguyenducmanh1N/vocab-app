import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RefreshToken


async def add(session: AsyncSession, token: RefreshToken) -> RefreshToken:
    session.add(token)
    await session.flush()
    return token


async def get_by_hash_for_update(session: AsyncSession, token_hash: str) -> RefreshToken | None:
    """Khoá dòng (FOR UPDATE) để hai lần refresh cùng một token không cùng lúc qua được."""
    return await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash).with_for_update()
    )


async def revoke_family(
    session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID, at: datetime
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.family_id == family_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=at)
    )


async def revoke_by_hash(
    session: AsyncSession, user_id: uuid.UUID, token_hash: str, at: datetime
) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=at)
    )


async def revoke_all_for_user(session: AsyncSession, user_id: uuid.UUID, at: datetime) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=at)
    )
