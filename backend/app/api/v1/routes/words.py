import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import CurrentUser, DbSession
from app.schemas.common import Page
from app.schemas.word import (
    BulkCreate,
    BulkOut,
    SearchParams,
    WordCreate,
    WordFilters,
    WordOut,
    WordSearchOut,
    WordUpdate,
)
from app.services import word_service

router = APIRouter(tags=["words"])


@router.get("/lists/{list_id}/words")
async def list_words(
    list_id: uuid.UUID,
    filters: Annotated[WordFilters, Query()],
    db: DbSession,
    user: CurrentUser,
) -> Page[WordOut]:
    """Lọc theo level, starred, q; sắp theo created_at tăng dần."""
    return await word_service.list_words(db, user.id, list_id, filters)


@router.post("/lists/{list_id}/words", status_code=status.HTTP_201_CREATED)
async def create_word(
    list_id: uuid.UUID,
    data: WordCreate,
    db: DbSession,
    user: CurrentUser,
    allow_duplicate: bool = False,
) -> WordOut:
    return await word_service.create(db, user.id, list_id, data, allow_duplicate=allow_duplicate)


@router.post("/lists/{list_id}/words/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_words(
    list_id: uuid.UUID, data: BulkCreate, db: DbSession, user: CurrentUser
) -> BulkOut:
    return await word_service.bulk_create(db, user.id, list_id, data)


# Khai báo trước /words/{word_id} để "search" không bị hiểu là word_id.
@router.get("/words/search")
async def search_words(
    params: Annotated[SearchParams, Query()], db: DbSession, user: CurrentUser
) -> list[WordSearchOut]:
    return await word_service.search(db, user.id, params)


@router.get("/words/{word_id}")
async def get_word(word_id: uuid.UUID, db: DbSession, user: CurrentUser) -> WordOut:
    return await word_service.get(db, user.id, word_id)


@router.patch("/words/{word_id}")
async def update_word(
    word_id: uuid.UUID, data: WordUpdate, db: DbSession, user: CurrentUser
) -> WordOut:
    return await word_service.update(db, user.id, word_id, data)


@router.delete("/words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_word(word_id: uuid.UUID, db: DbSession, user: CurrentUser) -> Response:
    await word_service.delete(db, user.id, word_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
