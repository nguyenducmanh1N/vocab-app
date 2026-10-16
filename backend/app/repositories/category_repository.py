import uuid

from sqlalchemy import Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category, WordList


def _with_list_count(user_id: uuid.UUID) -> Select[tuple[Category, int]]:
    return (
        select(Category, func.count(WordList.id))
        .outerjoin(WordList, and_(WordList.category_id == Category.id, WordList.user_id == user_id))
        .where(Category.user_id == user_id)
        .group_by(Category.id)
    )


async def list_with_counts(session: AsyncSession, user_id: uuid.UUID) -> list[tuple[Category, int]]:
    """Ghim trước, rồi sort_order, rồi tên (PLAN.md 8.3)."""
    rows = await session.execute(
        _with_list_count(user_id).order_by(
            Category.is_pinned.desc(), Category.sort_order, Category.name, Category.created_at
        )
    )
    return [(category, count) for category, count in rows]


async def get(session: AsyncSession, user_id: uuid.UUID, category_id: uuid.UUID) -> Category | None:
    return await session.scalar(
        select(Category).where(Category.id == category_id, Category.user_id == user_id)
    )


async def list_count(session: AsyncSession, user_id: uuid.UUID, category_id: uuid.UUID) -> int:
    count = await session.scalar(
        select(func.count(WordList.id)).where(
            WordList.user_id == user_id, WordList.category_id == category_id
        )
    )
    return count or 0


async def name_exists(
    session: AsyncSession, user_id: uuid.UUID, name: str, exclude_id: uuid.UUID | None = None
) -> bool:
    query = select(Category.id).where(Category.user_id == user_id, Category.name == name)
    if exclude_id is not None:
        query = query.where(Category.id != exclude_id)
    return await session.scalar(query.limit(1)) is not None


async def add(session: AsyncSession, category: Category) -> Category:
    session.add(category)
    await session.flush()
    await session.refresh(category)
    return category


async def delete(session: AsyncSession, category: Category) -> None:
    # word_lists.category_id có ON DELETE SET NULL: các list chuyển về "Chưa phân loại".
    await session.delete(category)
    await session.flush()
