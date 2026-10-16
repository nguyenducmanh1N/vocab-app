from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DictionaryCache(Base):
    """Cache Free Dictionary API, dùng chung cho mọi user, tra theo term."""

    __tablename__ = "dictionary_cache"

    term: Mapped[str] = mapped_column(String(100), primary_key=True)  # chữ thường
    # false = từ điển không có, tránh gọi lại liên tục
    found: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ipa: Mapped[str | None] = mapped_column(String(100))
    audio_url: Mapped[str | None] = mapped_column(Text)
    part_of_speech: Mapped[str | None] = mapped_column(String(20))
    definitions_en: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )
    raw: Mapped[Any] = mapped_column(JSONB, nullable=True)  # response gốc (mảng entry)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
