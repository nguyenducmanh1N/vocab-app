from fastapi import APIRouter
from sqlalchemy import text

from app.api.v1.deps import DbSession

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(db: DbSession) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "ok"}
