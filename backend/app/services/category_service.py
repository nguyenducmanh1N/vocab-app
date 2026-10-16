"""Danh mục của người dùng (PLAN.md 8.3)."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import Category
from app.repositories import category_repository as repo
from app.schemas.category import CategoryCreate, CategoryOut, CategoryUpdate


def _not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "Không tìm thấy danh mục")


def _duplicate_name(name: str) -> AppError:
    return AppError(409, "DUPLICATE_NAME", "Đã có danh mục cùng tên", {"name": name})


def _to_out(category: Category, list_count: int) -> CategoryOut:
    return CategoryOut(
        id=category.id,
        name=category.name,
        icon=category.icon,
        color=category.color,
        sort_order=category.sort_order,
        is_pinned=category.is_pinned,
        list_count=list_count,
    )


async def _get_owned(session: AsyncSession, user_id: uuid.UUID, category_id: uuid.UUID) -> Category:
    category = await repo.get(session, user_id, category_id)
    if category is None:
        raise _not_found()  # không phân biệt "không có" và "của người khác" (PLAN.md 6.3)
    return category


async def _commit_or_duplicate(session: AsyncSession, name: str) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:  # hai request cùng tên cùng lúc
        await session.rollback()
        raise _duplicate_name(name) from exc


async def list_categories(session: AsyncSession, user_id: uuid.UUID) -> list[CategoryOut]:
    rows = await repo.list_with_counts(session, user_id)
    return [_to_out(category, count) for category, count in rows]


async def create(session: AsyncSession, user_id: uuid.UUID, data: CategoryCreate) -> CategoryOut:
    if await repo.name_exists(session, user_id, data.name):
        raise _duplicate_name(data.name)
    try:
        category = await repo.add(session, Category(user_id=user_id, **data.model_dump()))
    except IntegrityError as exc:  # hai request cùng tên cùng lúc
        await session.rollback()
        raise _duplicate_name(data.name) from exc
    await session.commit()
    return _to_out(category, 0)


async def update(
    session: AsyncSession, user_id: uuid.UUID, category_id: uuid.UUID, data: CategoryUpdate
) -> CategoryOut:
    category = await _get_owned(session, user_id, category_id)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and await repo.name_exists(
        session, user_id, changes["name"], exclude_id=category.id
    ):
        raise _duplicate_name(changes["name"])

    for field, value in changes.items():
        setattr(category, field, value)
    await _commit_or_duplicate(session, category.name)
    count = await repo.list_count(session, user_id, category.id)
    return _to_out(category, count)


async def delete(session: AsyncSession, user_id: uuid.UUID, category_id: uuid.UUID) -> None:
    category = await _get_owned(session, user_id, category_id)
    await repo.delete(session, category)
    await session.commit()
