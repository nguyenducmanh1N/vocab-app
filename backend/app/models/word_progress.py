import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, false, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WordProgress(Base):
    """Lịch ôn SM-2 của một từ; tạo cùng transaction với từ. Mức thuộc tính ở PLAN.md 7.4."""

    __tablename__ = "word_progress"
    __table_args__ = (Index("ix_word_progress_user_due", "user_id", "due_at"),)

    word_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("words.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    ease_factor: Mapped[Decimal] = mapped_column(
        Numeric(4, 2), nullable=False, server_default=text("2.50")
    )
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    lapses: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # null = từ mới, chưa học lần nào
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    wrong_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    # Từ khó dai dẳng (PLAN.md 9.11)
    is_leech: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
