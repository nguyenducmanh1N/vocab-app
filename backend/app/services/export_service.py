"""Xuất từ vựng ra CSV (PLAN.md 8.3): UTF-8 có BOM để Excel đọc đúng tiếng Việt."""

import csv
import io
import re
import uuid
from collections.abc import Sequence
from datetime import date
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.levels import level_of
from app.core.text import topic_key
from app.core.time import local_today
from app.models import User, Word, WordProgress
from app.repositories import word_list_repository, word_repository

BOM = "﻿"
MAX_EXAMPLES = 3  # như giới hạn examples ở 8.2
COLUMNS = [
    "list_name",
    "term",
    "part_of_speech",
    "ipa",
    "meaning_vi",
    "definition_en",
    "synonyms",
    *(f"example_{i}_{lang}" for i in range(1, MAX_EXAMPLES + 1) for lang in ("en", "vi")),
    "note",
    "is_starred",
    "level",
    "correct_count",
    "wrong_count",
    "created_at",
]
# Ô bắt đầu bằng các ký tự này bị Excel hiểu là công thức (CSV injection, OWASP): thêm ' ở đầu.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def _row(list_name: str, word: Word, progress: WordProgress) -> list[str]:
    examples = list(word.examples or [])[:MAX_EXAMPLES]
    examples += [{}] * (MAX_EXAMPLES - len(examples))
    return [
        _cell(value)
        for value in (
            list_name,
            word.term,
            word.part_of_speech,
            word.ipa,
            word.meaning_vi,
            word.definition_en,
            "; ".join(word.synonyms or []),
            *(example.get(lang) for example in examples for lang in ("en", "vi")),
            word.note,
            word.is_starred,
            level_of(progress.due_at, progress.interval_days),
            progress.correct_count,
            progress.wrong_count,
            word.created_at.isoformat(),
        )
    ]


def words_csv(rows: Sequence[tuple[str, Word, WordProgress]]) -> str:
    """CSV theo RFC 4180 (dấu phẩy, CRLF), có BOM."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)  # mặc định lineterminator="\r\n", quote khi cần
    writer.writerow(COLUMNS)
    writer.writerows(_row(*row) for row in rows)
    return BOM + buffer.getvalue()


def content_disposition(name: str, day: date) -> str:
    """attachment; filename ASCII (bỏ dấu) + filename* UTF-8 giữ nguyên tên tiếng Việt."""
    stamp = day.strftime("%Y%m%d")
    ascii_name = re.sub(r"[^a-z0-9]+", "-", topic_key(name)).strip("-")[:60] or "tu-vung"
    utf8_name = quote(f"vocabtopic-{name}-{stamp}.csv", safe="")
    ascii_file = f"vocabtopic-{ascii_name}-{stamp}.csv"
    return f"attachment; filename=\"{ascii_file}\"; filename*=UTF-8''{utf8_name}"


async def export_list(session: AsyncSession, user: User, list_id: uuid.UUID) -> tuple[str, str]:
    """(nội dung CSV, Content-Disposition) cho một list; list của người khác → 404."""
    word_list = await word_list_repository.get(session, user.id, list_id)
    if word_list is None:
        raise AppError(404, "NOT_FOUND", "Không tìm thấy list")
    rows = await word_repository.export_rows(session, user.id, list_id)
    return words_csv(rows), content_disposition(word_list.name, local_today(user.timezone))


async def export_all(session: AsyncSession, user: User) -> tuple[str, str]:
    """Mọi từ của user, theo tên list; dùng để sao lưu (vd. trước khi xoá tài khoản)."""
    rows = await word_repository.export_rows(session, user.id)
    return words_csv(rows), content_disposition("tất cả từ vựng", local_today(user.timezone))
