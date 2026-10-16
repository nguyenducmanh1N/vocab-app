"""dictionary_cache dùng chung cho mọi user, nên không lọc theo user_id."""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DictionaryCache


async def get_many(session: AsyncSession, terms: Sequence[str]) -> dict[str, DictionaryCache]:
    if not terms:
        return {}
    rows = await session.scalars(select(DictionaryCache).where(DictionaryCache.term.in_(terms)))
    return {row.term: row for row in rows}


async def upsert_many(session: AsyncSession, values: Sequence[dict[str, Any]]) -> None:
    if not values:
        return
    stmt = insert(DictionaryCache).values(list(values))
    stmt = stmt.on_conflict_do_update(
        index_elements=[DictionaryCache.term],
        set_={
            column: stmt.excluded[column]
            for column in (
                "found",
                "ipa",
                "audio_url",
                "part_of_speech",
                "definitions_en",
                "raw",
                "fetched_at",
            )
        },
    )
    await session.execute(stmt)
