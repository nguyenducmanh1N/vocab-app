"""Gợi ý từ theo chủ đề (PLAN.md 9.7), tự điền (9.8) và nhận xét luyện nói (9.11) bằng AI."""

import asyncio
import base64
import binascii
import json
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.dictionary import DictionaryClient
from app.clients.gemini import (
    AiClient,
    AudioInput,
    EnrichResult,
    GeneratedWord,
    ImageInput,
    SpeakingEvaluation,
    SpeakingTranscript,
    SuggestResult,
    upstream_error,
)
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.text import (
    collapse_spaces,
    english_words,
    looks_like_correction,
    normalize_term,
    sentence_similarity,
    topic_key,
)
from app.core.time import local_today, now_utc, start_of_local_day
from app.models import AiGeneration, User
from app.repositories import ai_generation_repository as repo
from app.schemas.ai import (
    EnrichIn,
    EnrichOut,
    ExtractIn,
    HistoryItem,
    QuotaOut,
    SpeakingCriterionOut,
    SpeakingFeedbackIn,
    SpeakingFeedbackOut,
    SpeakingFixOut,
    SuggestedWord,
    SuggestIn,
    SuggestOut,
)
from app.services import dictionary_service

SUGGEST_PROMPT = """You are an English vocabulary teacher for Vietnamese learners.
Topic: "{topic}"
Learner level (CEFR): {level}
Return exactly {count} useful English items for this topic.
Allowed item types: {word_types}.
Do not include any of these terms: {exclude_terms}.
Rules:
- Prefer words and phrases people actually use in this situation.
- meaning_vi: short, natural Vietnamese meanings separated by "; ".
- ipa: American English IPA between slashes.
- synonyms: up to 5 common English synonyms or near-synonyms (aim for 4-5;
  fewer only if the term really has fewer).
- examples: 1-2 short sentences (max 15 words) that contain the item,
  each with a natural Vietnamese translation."""

CACHE_TTL = timedelta(days=7)

EXTRACT_PROMPT = """You are an English vocabulary teacher for Vietnamese learners (CEFR {level}).
Look at the image (e.g. a book page, sign or note) and pick up to {count} English words or phrases
from it that are worth learning at this level. Skip names, numbers and very basic words.
Rules:
- term: as it appears in the image, in dictionary form, lowercase.
- meaning_vi: short, natural Vietnamese meanings separated by "; ".
- ipa: American English IPA between slashes.
- synonyms: up to 5 common English synonyms or near-synonyms (aim for 4-5;
  fewer only if the term really has fewer).
- examples: 1-2 short sentences (max 15 words) that contain the item,
  each with a natural Vietnamese translation."""

EXTRACT_TOPIC = "Từ trong ảnh"

ENRICH_PROMPT = """You are an English vocabulary teacher for Vietnamese learners (CEFR {level}).
For each English term below, return one item, in the same order.
Terms: {terms_json}
Rules:
- part_of_speech: noun, verb, adjective, adverb, phrase or idiom.
- meaning_vi: short, natural Vietnamese meanings separated by "; ".
- ipa: American English IPA between slashes.
- synonyms: up to 5 common English synonyms or near-synonyms (aim for 4-5;
  fewer only if the term really has fewer).
- examples: 1-2 short sentences (max 15 words) that contain the term,
  each with a natural Vietnamese translation.
- If a term is misspelled, return the item with the corrected spelling in term.
- If a term is not a real English word or phrase, put it in unknown_terms."""


# Nhận xét luyện nói gọi 2 lần (9.11). Lần 1 chỉ chép lời, KHÔNG đưa câu mẫu: thử thật ngày
# 16/10/2026, có câu mẫu trong prompt thì model chép lại câu mẫu kể cả khi bản ghi im lặng.
SPEAKING_TRANSCRIBE_PROMPT = """Transcribe the English speech in this audio exactly as spoken,
including mispronounced or wrong words. Do not correct anything.
If there is no clear speech, return an empty transcript."""

SPEAKING_EVALUATE_PROMPT = """You are an English pronunciation coach for Vietnamese learners \
(CEFR {level}).
Target sentence: {reference}
{term_line}A separate listener transcribed the recording as: {transcript}
Listen to the recording and evaluate how the learner pronounced the target sentence.
Evaluate ONLY what you actually hear. Do not invent problems.
- Score 1-5: pronunciation (individual sounds, final consonants), stress (word stress and
  sentence intonation), fluency (pace, pauses, hesitation). Give one short Vietnamese sentence each.
- fixes: at most 3 words that were mispronounced most clearly, with American IPA, what went wrong
  and how to fix it, in Vietnamese. Leave empty if nothing is clearly wrong.
- summary_vi: 1-2 short, encouraging Vietnamese sentences."""

# Dưới ngưỡng này coi là đọc câu khác. Bản đọc sai nhiều chỗ vẫn đạt khoảng 0,5 (xem test_text).
SPEAKING_MIN_SIMILARITY = 0.4
# Tổng thời gian cho cả 2 lần gọi (kể cả model dự phòng); app chờ tối đa 45 giây.
SPEAKING_DEADLINE_SECONDS = 40

SPEAKING_NOT_SCORED = {
    "no_speech": "Chưa nghe rõ tiếng nói. Hãy ghi lại ở chỗ yên tĩnh và để máy gần miệng hơn.",
    "different_sentence": "Bản ghi có vẻ không phải câu mẫu. Nghe mẫu rồi đọc lại đúng câu nhé.",
}


def _apply_dictionary(item: dict[str, Any], entry: Any) -> None:
    """Bước 7: từ điển có thì ghi đè IPA, audio và lưu định nghĩa tiếng Anh (không có thì thôi)."""
    if entry is None or not entry.found:
        return
    item["ipa"] = entry.ipa or item["ipa"]
    item["audio_url"] = entry.audio_url
    if entry.definitions_en:
        item["definition_en"] = "\n".join(entry.definitions_en)[:1500]


def match_corrections(
    terms: list[str], generated: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Ghép kết quả AI với term đã gửi, giữ đúng thứ tự terms (PLAN.md 9.8).

    Term khớp đúng thì lấy luôn. Term không khớp: nếu AI trả một từ gần giống (sai chính tả,
    vd. "recieve" → "receive") thì nhận làm bản sửa, ghi corrected_from; không thì vào unknown.
    """
    by_term = {item["term"]: item for item in generated if item["meaning_vi"]}
    leftovers = [item for term, item in by_term.items() if term not in terms]
    items: list[dict[str, Any]] = []
    unknown: list[str] = []
    for term in terms:
        if term in by_term:
            items.append(by_term[term])
            continue
        match = next((c for c in leftovers if looks_like_correction(term, c["term"])), None)
        if match is None:
            unknown.append(term)
            continue
        leftovers.remove(match)
        items.append({**match, "corrected_from": term})
    return items, unknown


async def _check_quota(session: AsyncSession, user: User, kind: str, limit: int) -> int:
    """Trả số lượt còn lại trước lần gọi này; hết lượt → 429 kèm resets_at (đầu ngày mai local)."""
    today = local_today(user.timezone)
    used = await repo.count_used(session, user.id, kind, start_of_local_day(today, user.timezone))
    if used >= limit:
        resets_at = start_of_local_day(today + timedelta(days=1), user.timezone)
        raise AppError(
            429,
            "AI_QUOTA_EXCEEDED",
            "Bạn đã dùng hết lượt AI hôm nay",
            {"resets_at": resets_at.isoformat()},
        )
    return limit - used


def _clean(value: str | None, max_length: int) -> str | None:
    if value is None:
        return None
    value = collapse_spaces(value)
    return value[:max_length] or None


def normalize_word(word: GeneratedWord) -> dict[str, Any]:
    """Cắt khoảng trắng, term viết thường, cắt độ dài theo giới hạn ở 8.2 (bước 5, 6)."""
    term = normalize_term(word.term)
    synonyms: list[str] = []
    for synonym in word.synonyms:
        cleaned = _clean(synonym, 60)
        if (
            cleaned
            and cleaned.lower() not in {s.lower() for s in synonyms}
            and cleaned.lower() != term
        ):
            synonyms.append(cleaned)
    examples = [
        {"en": en, "vi": _clean(ex.vi, 300) or ""}
        for ex in word.examples[:3]
        if (en := _clean(ex.en, 300))
    ]
    return {
        "term": term,
        "part_of_speech": (_clean(word.part_of_speech, 20) or "").lower() or None,
        "ipa": _clean(word.ipa, 100),
        "meaning_vi": _clean(word.meaning_vi, 500) or "",
        "synonyms": synonyms[:5],
        "examples": examples,
        "audio_url": None,
        "definition_en": None,
        "cloze_ready": any(term in ex["en"].lower() for ex in examples),
        "corrected_from": None,
    }


async def _record(
    session: AsyncSession,
    user: User,
    *,
    kind: str,
    level: str,
    count: int | None,
    model: str,
    status: str,
    result: Any = None,
    error: str | None = None,
    topic: str | None = None,
    cache_key: str | None = None,
) -> AiGeneration:
    generation = await repo.add(
        session,
        AiGeneration(
            user_id=user.id,
            kind=kind,
            topic=topic,
            cache_key=cache_key,
            level=level,
            word_count=count,
            model=model,
            status=status,
            result=result,
            error=error,
            # Đặt từ now_utc() để test hạn mức theo ngày bằng đồng hồ giả.
            created_at=now_utc(),
        ),
    )
    await session.commit()
    return generation


async def enrich(
    session: AsyncSession,
    user: User,
    data: EnrichIn,
    ai: AiClient,
    dictionary: DictionaryClient,
) -> EnrichOut:
    settings = get_settings()
    level = data.level or user.level
    terms = list(dict.fromkeys(normalize_term(t) for t in data.terms))
    remaining = await _check_quota(session, user, "enrich", settings.ai_enrich_daily_limit)

    prompt = ENRICH_PROMPT.format(level=level, terms_json=json.dumps(terms, ensure_ascii=False))
    # Gemini và từ điển chạy song song: tổng thời gian ≈ bên chậm hơn, không cộng dồn.
    # Đợi cả hai xong (return_exceptions) vì từ điển còn dùng session để ghi cache.
    ai_outcome, lookups = await asyncio.gather(
        ai.generate(prompt, EnrichResult),
        dictionary_service.lookup_many(session, dictionary, terms),
        return_exceptions=True,
    )
    if isinstance(lookups, BaseException):
        raise lookups
    if isinstance(ai_outcome, BaseException):
        exc = ai_outcome
        await _record(
            session,
            user,
            kind="enrich",
            level=level,
            count=len(terms),
            model=settings.gemini_model,
            status="error",
            error=repr(exc.__cause__ or exc),
        )
        raise exc
    result, model = ai_outcome

    # Giữ đúng thứ tự terms; term AI không trả về coi như không nhận ra.
    items, unknown = match_corrections(terms, list(map(normalize_word, result.words)))
    # Từ đã sửa chính tả thì tra từ điển theo bản đúng (lần tra song song dùng bản sai).
    corrected = [i["term"] for i in items if i["corrected_from"]]
    if corrected:
        lookups = {
            **lookups,
            **await dictionary_service.lookup_many(session, dictionary, corrected),
        }

    # Bước 7: từ điển có IPA, audio thì ghi đè (chỉ tra cụm tối đa 3 từ, lỗi coi như không có).
    for item in items:
        _apply_dictionary(item, lookups.get(item["term"]))

    await _record(
        session,
        user,
        kind="enrich",
        level=level,
        count=len(terms),
        model=model,
        status="ok",
        result={"words": items, "unknown_terms": unknown},
    )
    saved = await repo.saved_terms(session, user.id, [i["term"] for i in items])
    return EnrichOut(
        remaining_today=remaining - 1,
        words=[SuggestedWord(**item, already_saved=item["term"] in saved) for item in items],
        unknown_terms=unknown,
    )


async def _with_saved(
    session: AsyncSession, user: User, items: list[dict[str, Any]]
) -> list[SuggestedWord]:
    """Bước 8: already_saved tính tại thời điểm gọi (kể cả khi lấy từ cache)."""
    saved = await repo.saved_terms(session, user.id, [i["term"] for i in items])
    return [SuggestedWord(**item, already_saved=item["term"] in saved) for item in items]


async def suggest(
    session: AsyncSession,
    user: User,
    data: SuggestIn,
    ai: AiClient,
    dictionary: DictionaryClient,
) -> SuggestOut:
    """Gợi ý từ theo chủ đề, đúng 9 bước ở PLAN.md 9.7."""
    settings = get_settings()
    level = data.level or user.level
    word_types = sorted(data.word_types)
    # Bước 1
    cache_key = f"{topic_key(data.topic)}|{level}|{data.count}|{','.join(word_types)}"
    # Bước 2
    remaining = await _check_quota(session, user, "suggest", settings.ai_suggest_daily_limit)
    meta = {"kind": "suggest", "level": level, "count": data.count, "topic": data.topic}

    # Bước 3: cache 7 ngày khi không loại trừ từ nào; ghi dòng model='cache', không tính lượt.
    if not data.exclude_terms:
        cached = await repo.find_cached(session, cache_key, now_utc() - CACHE_TTL)
        if cached is not None:
            items = list(cached.result)
            generation = await _record(
                session,
                user,
                **meta,
                cache_key=cache_key,
                model="cache",
                status="ok",
                result=items,
            )
            return SuggestOut(
                generation_id=generation.id,
                cached=True,
                remaining_today=remaining,
                words=await _with_saved(session, user, items),
            )

    # Bước 4
    exclude = list(dict.fromkeys(normalize_term(t) for t in data.exclude_terms))
    prompt = SUGGEST_PROMPT.format(
        topic=data.topic,
        level=level,
        count=data.count,
        word_types=", ".join(word_types),
        exclude_terms=json.dumps(exclude, ensure_ascii=False),
    )
    try:
        result, model = await ai.generate(prompt, SuggestResult)
    except AppError as exc:
        await _record(
            session,
            user,
            **meta,
            cache_key=cache_key,
            model=settings.gemini_model,
            status="error",
            error=repr(exc.__cause__ or exc),
        )
        raise

    # Bước 5, 6: chuẩn hoá, bỏ trùng, bỏ từ bị loại trừ, cắt về đúng count.
    excluded = set(exclude)
    items: list[dict[str, Any]] = []
    for item in map(normalize_word, result.words):
        if item["meaning_vi"] and item["term"] not in excluded:
            if item["term"] not in {i["term"] for i in items}:
                items.append(item)
    items = items[: data.count]

    # Bước 7: từ điển song song (tối đa 5 cùng lúc, chỉ cụm ≤ 3 từ); có thì ghi đè IPA, audio.
    lookups = await dictionary_service.lookup_many(session, dictionary, [i["term"] for i in items])
    for item in items:
        _apply_dictionary(item, lookups.get(item["term"]))

    # Bước 9: lưu kết quả đã chuẩn hoá (chưa gắn already_saved).
    generation = await _record(
        session, user, **meta, cache_key=cache_key, model=model, status="ok", result=items
    )
    return SuggestOut(
        generation_id=generation.id,
        cached=False,
        remaining_today=remaining - 1,
        words=await _with_saved(session, user, items),
    )


async def _remaining(session: AsyncSession, user: User, kind: str, limit: int) -> int:
    today = local_today(user.timezone)
    used = await repo.count_used(session, user.id, kind, start_of_local_day(today, user.timezone))
    return max(limit - used, 0)


async def history(session: AsyncSession, user: User, limit: int) -> list[HistoryItem]:
    rows = await repo.list_history(session, user.id, limit)
    return [
        HistoryItem(
            generation_id=row.id,
            topic=row.topic,
            level=row.level,
            word_count=row.word_count,
            created_at=row.created_at,
        )
        for row in rows
    ]


async def history_detail(session: AsyncSession, user: User, generation_id: uuid.UUID) -> SuggestOut:
    """Như response của /ai/suggest; already_saved tính lại tại thời điểm gọi, không tốn lượt."""
    row = await repo.get_history(session, user.id, generation_id)
    if row is None:
        raise AppError(404, "NOT_FOUND", "Không tìm thấy lượt gợi ý")
    remaining = await _remaining(session, user, "suggest", get_settings().ai_suggest_daily_limit)
    return SuggestOut(
        generation_id=row.id,
        cached=False,
        remaining_today=remaining,
        words=await _with_saved(session, user, list(row.result or [])),
    )


async def quota(session: AsyncSession, user: User) -> QuotaOut:
    """Số lượt AI còn lại hôm nay; không tốn lượt."""
    settings = get_settings()
    tomorrow = local_today(user.timezone) + timedelta(days=1)
    return QuotaOut(
        suggest_remaining=await _remaining(
            session, user, "suggest", settings.ai_suggest_daily_limit
        ),
        enrich_remaining=await _remaining(session, user, "enrich", settings.ai_enrich_daily_limit),
        speaking_remaining=await _remaining(
            session, user, "speaking", settings.ai_speaking_daily_limit
        ),
        resets_at=start_of_local_day(tomorrow, user.timezone),
    )


async def extract(
    session: AsyncSession,
    user: User,
    data: ExtractIn,
    ai: AiClient,
    dictionary: DictionaryClient,
) -> SuggestOut:
    """Lọc từ đáng học trong ảnh; tính một lượt gợi ý (không cache), xem trước như 9.7."""
    try:
        image = base64.b64decode(data.image_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise AppError(422, "VALIDATION_ERROR", "Ảnh không hợp lệ") from exc

    settings = get_settings()
    level = data.level or user.level
    remaining = await _check_quota(session, user, "suggest", settings.ai_suggest_daily_limit)
    meta = {"kind": "suggest", "level": level, "count": data.count, "topic": EXTRACT_TOPIC}
    prompt = EXTRACT_PROMPT.format(level=level, count=data.count)
    try:
        result, model = await ai.generate(
            prompt, SuggestResult, [ImageInput(image, data.mime_type)]
        )
    except AppError as exc:
        await _record(
            session,
            user,
            **meta,
            model=settings.gemini_model,
            status="error",
            error=repr(exc.__cause__ or exc),
        )
        raise

    items: list[dict[str, Any]] = []
    for item in map(normalize_word, result.words):
        if item["meaning_vi"] and item["term"] not in {i["term"] for i in items}:
            items.append(item)
    items = items[: data.count]
    lookups = await dictionary_service.lookup_many(session, dictionary, [i["term"] for i in items])
    for item in items:
        _apply_dictionary(item, lookups.get(item["term"]))

    generation = await _record(session, user, **meta, model=model, status="ok", result=items)
    return SuggestOut(
        generation_id=generation.id,
        cached=False,
        remaining_today=remaining - 1,
        words=await _with_saved(session, user, items),
    )


def _speaking_status(transcript: str, reference: str) -> str:
    if not english_words(transcript):
        return "no_speech"
    if sentence_similarity(transcript, reference) < SPEAKING_MIN_SIMILARITY:
        return "different_sentence"
    return "ok"


def _criterion(value: Any) -> SpeakingCriterionOut:
    return SpeakingCriterionOut(score=value.score, comment_vi=_clean(value.comment_vi, 300) or "")


async def speaking_feedback(
    session: AsyncSession, user: User, data: SpeakingFeedbackIn, ai: AiClient
) -> SpeakingFeedbackOut:
    """Nhận xét bản ghi luyện nói (9.11).

    Bản ghi chỉ nằm trong bộ nhớ của request: không ghi ra đĩa, không lưu vào ai_generations.
    Chỉ lần có chấm (status ok) mới tính lượt.
    """
    try:
        clip = AudioInput(base64.b64decode(data.audio_base64, validate=True), data.mime_type)
    except (ValueError, binascii.Error) as exc:
        raise AppError(422, "VALIDATION_ERROR", "Bản ghi không hợp lệ") from exc

    settings = get_settings()
    level = data.level or user.level
    remaining = await _check_quota(session, user, "speaking", settings.ai_speaking_daily_limit)
    meta = {"kind": "speaking", "level": level, "count": None}
    try:
        async with asyncio.timeout(SPEAKING_DEADLINE_SECONDS):
            heard, model = await ai.generate(
                SPEAKING_TRANSCRIBE_PROMPT, SpeakingTranscript, audio=[clip]
            )
            transcript = _clean(heard.transcript, 500) or ""
            status = _speaking_status(transcript, data.reference_text)
            evaluation: SpeakingEvaluation | None = None
            if status == "ok":
                term_line = f"Target word: {json.dumps(data.term)}\n" if data.term else ""
                prompt = SPEAKING_EVALUATE_PROMPT.format(
                    level=level,
                    reference=json.dumps(data.reference_text, ensure_ascii=False),
                    term_line=term_line,
                    transcript=json.dumps(transcript, ensure_ascii=False),
                )
                evaluation, model = await ai.generate(prompt, SpeakingEvaluation, audio=[clip])
    except (AppError, TimeoutError) as exc:
        error = exc if isinstance(exc, AppError) else upstream_error()
        await _record(
            session,
            user,
            **meta,
            model=settings.gemini_model,
            status="error",
            error=repr(exc.__cause__ or exc),
        )
        raise error from exc

    feedback = SpeakingFeedbackOut(
        remaining_today=remaining - 1 if status == "ok" else remaining,
        status=status,  # type: ignore[arg-type]
        transcript=transcript,
        overall=evaluation.overall if evaluation else None,
        pronunciation=_criterion(evaluation.pronunciation) if evaluation else None,
        stress=_criterion(evaluation.stress) if evaluation else None,
        fluency=_criterion(evaluation.fluency) if evaluation else None,
        fixes=[
            SpeakingFixOut(
                word=_clean(fix.word, 100) or "",
                ipa=_clean(fix.ipa, 100) or "",
                issue_vi=_clean(fix.issue_vi, 300) or "",
                tip_vi=_clean(fix.tip_vi, 300) or "",
            )
            for fix in (evaluation.fixes[:3] if evaluation else [])
        ],
        summary_vi=(
            _clean(evaluation.summary_vi, 500) or "" if evaluation else SPEAKING_NOT_SCORED[status]
        ),
    )
    result = {
        "status": status,
        "reference_text": data.reference_text,
        "term": data.term,
        "feedback": feedback.model_dump(exclude={"remaining_today"}),
    }
    await _record(session, user, **meta, model=model, status="ok", result=result)
    return feedback
