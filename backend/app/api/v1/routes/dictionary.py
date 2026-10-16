from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.api.v1.deps import CurrentUser, DbSession, Dictionary, Suggester
from app.schemas.dictionary import DictionaryOut, TermSuggestion
from app.services import dictionary_service

router = APIRouter(prefix="/dictionary", tags=["dictionary"])


# Khai báo trước /{term} để "suggest" không bị hiểu là một từ.
@router.get("/suggest")
async def suggest(
    q: Annotated[str, Query(min_length=1, max_length=100, pattern=r"\S")],
    db: DbSession,
    client: Suggester,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=20)] = 8,
) -> list[TermSuggestion]:
    """Gợi ý khi gõ ở ô Từ: từ đã lưu trước, rồi từ tiếng Anh (Datamuse); lỗi thì trả ít hơn."""
    return await dictionary_service.suggest(db, user.id, client, q, limit)


@router.get("/{term}")
async def lookup(
    term: Annotated[str, Path(min_length=1, max_length=100, pattern=r"\S")],
    db: DbSession,
    client: Dictionary,
    _: CurrentUser,
) -> DictionaryOut:
    """Tra Free Dictionary có cache; từ điển lỗi thì trả found=false thay vì báo lỗi."""
    return await dictionary_service.lookup(db, client, term)
