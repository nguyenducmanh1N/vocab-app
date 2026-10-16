import uuid

from fastapi import APIRouter, Response, status

from app.api.v1.deps import CurrentUser, DbSession
from app.schemas.category import CategoryCreate, CategoryOut, CategoryUpdate
from app.services import category_service

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("")
async def list_categories(db: DbSession, user: CurrentUser) -> list[CategoryOut]:
    return await category_service.list_categories(db, user.id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_category(data: CategoryCreate, db: DbSession, user: CurrentUser) -> CategoryOut:
    return await category_service.create(db, user.id, data)


@router.patch("/{category_id}")
async def update_category(
    category_id: uuid.UUID, data: CategoryUpdate, db: DbSession, user: CurrentUser
) -> CategoryOut:
    return await category_service.update(db, user.id, category_id, data)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    await category_service.delete(db, user.id, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
