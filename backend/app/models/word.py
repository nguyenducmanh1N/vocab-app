import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, false, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Word(TimestampMixin, Base):
    __tablename__ = "words"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("word_lists.id", ondelete="CASCADE"), nullable=False
    )
    term: Mapped[str] = mapped_column(String(100), nullable=False)
    # noun, verb, adjective, adverb, phrase, idiom
    part_of_speech: Mapped[str | None] = mapped_column(String(20))
    ipa: Mapped[str | None] = mapped_column(String(100))
    meaning_vi: Mapped[str] = mapped_column(Text, nullable=False)  # nhiều nghĩa ngăn bằng "; "
    # Định nghĩa tiếng Anh từ từ điển (tối đa 3, mỗi dòng một định nghĩa); null nếu không có
    definition_en: Mapped[str | None] = mapped_column(Text)
    synonyms: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )  # tối đa 5
    examples: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )  # [{"en", "vi", "source", "source_id", "source_url"}], tối đa 5
    audio_url: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    is_starred: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    mnemonic: Mapped[str | None] = mapped_column(Text)  # mẹo nhớ
    word_family: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )  # [{"term", "part_of_speech", "meaning_vi", "example_en"}], tối đa 5
    collocations: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )  # [{"phrase", "meaning_vi", "example_en"}], tối đa 5
    confusables: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )  # [{"term", "difference_vi", "example_en", "other_example_en"}], tối đa 2

    # Hai index biểu thức tạo bằng op.execute trong migration (autogenerate không so sánh được).
    __table_args__ = (
        Index("ux_words_list_term", "list_id", func.lower(term), unique=True),
        Index("ix_words_user", "user_id"),
        Index(
            "ix_words_user_term_trgm",
            func.lower(term).label("term_lower"),
            postgresql_using="gin",
            postgresql_ops={"term_lower": "gin_trgm_ops"},
        ),
    )
