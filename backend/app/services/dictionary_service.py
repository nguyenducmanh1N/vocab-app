"""Tra từ điển có cache (PLAN.md 9.6). Lỗi từ điển không bao giờ làm hỏng request chính."""

import asyncio
import logging
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.datamuse import SuggestClient
from app.clients.dictionary import DictionaryClient, DictionaryUnavailable
from app.core.text import normalize_term
from app.core.time import now_utc
from app.models import DictionaryCache
from app.repositories import dictionary_cache_repository as cache_repo
from app.repositories import word_repository
from app.repositories.ai_generation_repository import saved_terms
from app.schemas.dictionary import DictionaryOut, TermSuggestion

logger = logging.getLogger(__name__)

FOUND_TTL = timedelta(days=30)
NOT_FOUND_TTL = timedelta(days=7)
MAX_WORDS = 3  # chỉ tra cụm tối đa 3 từ
MAX_DEFINITIONS = 3
CONCURRENCY = 5


def parse_entries(term: str, entries: list[dict[str, Any]]) -> DictionaryOut:
    """Rút IPA, audio, từ loại và tối đa 3 định nghĩa từ mảng entry của Free Dictionary."""
    phonetics = [p for e in entries for p in e.get("phonetics") or [] if isinstance(p, dict)]

    audios = [p["audio"] for p in phonetics if isinstance(p.get("audio"), str) and p["audio"]]
    audio_url = next((a for a in audios if a.endswith("-us.mp3")), audios[0] if audios else None)

    ipa_candidates = [e.get("phonetic") for e in entries] + [p.get("text") for p in phonetics]
    ipa = next((s for s in ipa_candidates if isinstance(s, str) and s.strip()), None)

    meanings = [m for e in entries for m in e.get("meanings") or [] if isinstance(m, dict)]
    part_of_speech = meanings[0].get("partOfSpeech") if meanings else None
    definitions = [
        d["definition"]
        for m in meanings
        for d in m.get("definitions") or []
        if isinstance(d, dict) and isinstance(d.get("definition"), str) and d["definition"]
    ][:MAX_DEFINITIONS]

    return DictionaryOut(
        term=term,
        found=True,
        ipa=ipa.strip()[:100] if ipa else None,
        audio_url=audio_url,
        part_of_speech=part_of_speech[:20] if isinstance(part_of_speech, str) else None,
        definitions_en=definitions,
    )


def _is_fresh(row: DictionaryCache, now: datetime) -> bool:
    return now - row.fetched_at < (FOUND_TTL if row.found else NOT_FOUND_TTL)


def _from_cache(row: DictionaryCache) -> DictionaryOut:
    return DictionaryOut(
        term=row.term,
        found=row.found,
        ipa=row.ipa,
        audio_url=row.audio_url,
        part_of_speech=row.part_of_speech,
        definitions_en=list(row.definitions_en),
    )


async def _fetch(
    client: DictionaryClient, semaphore: asyncio.Semaphore, term: str
) -> tuple[str, list[dict[str, Any]] | None] | None:
    """(term, entries | None nếu 404); None nếu từ điển lỗi (không cache, lần sau tra lại)."""
    async with semaphore:
        try:
            return term, await client.lookup(term)
        except DictionaryUnavailable as exc:
            logger.warning("dictionary %r: bỏ qua do lỗi: %s", term, exc)
            return None
        except Exception:  # lỗi bất ngờ cũng không được làm hỏng request chính
            logger.exception("dictionary %r: lỗi không mong đợi", term)
            return None


async def lookup_many(
    session: AsyncSession, client: DictionaryClient, terms: Sequence[str]
) -> dict[str, DictionaryOut]:
    """Tra nhiều từ; khoá của kết quả là term đã chuẩn hoá. Gọi HTTP song song tối đa 5."""
    now = now_utc()
    normalized = list(dict.fromkeys(normalize_term(t) for t in terms if t.strip()))
    results = {t: DictionaryOut(term=t, found=False) for t in normalized}

    eligible = [t for t in normalized if len(t.split()) <= MAX_WORDS]
    cached = await cache_repo.get_many(session, eligible)
    to_fetch = []
    for term in eligible:
        row = cached.get(term)
        if row is not None and _is_fresh(row, now):
            results[term] = _from_cache(row)
        else:
            to_fetch.append(term)
    if not to_fetch:
        return results

    semaphore = asyncio.Semaphore(CONCURRENCY)
    fetched = await asyncio.gather(*(_fetch(client, semaphore, t) for t in to_fetch))

    rows: list[dict[str, Any]] = []
    for term, item in zip(to_fetch, fetched, strict=True):
        if item is None:  # từ điển lỗi: không cache, báo available=false
            results[term] = DictionaryOut(term=term, found=False, available=False)
            continue
        term, entries = item
        out = parse_entries(term, entries) if entries else DictionaryOut(term=term, found=False)
        results[term] = out
        rows.append({**out.model_dump(exclude={"available"}), "raw": entries, "fetched_at": now})
    if rows:
        await cache_repo.upsert_many(session, rows)
        await session.commit()
    return results


async def lookup(session: AsyncSession, client: DictionaryClient, term: str) -> DictionaryOut:
    key = normalize_term(term)
    results = await lookup_many(session, client, [key])
    return results.get(key, DictionaryOut(term=key, found=False))


async def suggest(
    session: AsyncSession, user_id: uuid.UUID, client: SuggestClient, q: str, limit: int
) -> list[TermSuggestion]:
    """Gợi ý khi gõ: từ đã lưu khớp tiền tố đứng trước, rồi tới gợi ý tiếng Anh của Datamuse."""
    prefix = normalize_term(q)
    saved = await word_repository.terms_with_prefix(session, user_id, prefix, limit)
    english = [normalize_term(t) for t in await client.suggest(prefix, limit)]

    terms = list(dict.fromkeys([*saved, *english]))[:limit]
    already = set(saved) | await saved_terms(session, user_id, [t for t in terms if t not in saved])
    return [TermSuggestion(term=t, already_saved=t in already) for t in terms]
