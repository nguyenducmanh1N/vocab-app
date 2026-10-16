import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import CurrentUser, DbSession
from app.schemas.word_list import ListCreate, ListFilters, ListOut, ListUpdate
from app.services import export_service, word_list_service

router = APIRouter(prefix="/lists", tags=["lists"])


@router.get("")
async def list_lists(
    filters: Annotated[ListFilters, Query()], db: DbSession, user: CurrentUser
) -> list[ListOut]:
    """Lọc theo category_id, uncategorized (chưa phân loại) hoặc q; mới sửa gần nhất trước."""
    return await word_list_service.list_lists(db, user.id, filters)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_list(data: ListCreate, db: DbSession, user: CurrentUser) -> ListOut:
    return await word_list_service.create(db, user.id, data)


@router.get("/{list_id}")
async def get_list(list_id: uuid.UUID, db: DbSession, user: CurrentUser) -> ListOut:
    return await word_list_service.get(db, user.id, list_id)


@router.patch("/{list_id}")
async def update_list(
    list_id: uuid.UUID, data: ListUpdate, db: DbSession, user: CurrentUser
) -> ListOut:
    return await word_list_service.update(db, user.id, list_id, data)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(list_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    await word_list_service.delete(db, user.id, list_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{list_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_list(list_id: uuid.UUID, db: DbSession, user: CurrentUser) -> ListOut:
    """Nhân bản list và các từ; không chép tiến độ (mọi từ trong bản sao là từ mới)."""
    return await word_list_service.duplicate(db, user.id, list_id)


@router.get("/{list_id}/export")
async def export_list(list_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    """Từ của list dạng CSV (UTF-8 có BOM), theo thứ tự created_at."""
    content, disposition = await export_service.export_list(db, user, list_id)
    return Response(
        content, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": disposition}
    )
