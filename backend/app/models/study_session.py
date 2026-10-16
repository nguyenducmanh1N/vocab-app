import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StudySession(Base):
    """Một phiên học; `total`/`correct` đếm mọi câu, kể cả câu hỏi lại (PLAN.md 9.4)."""

    __tablename__ = "study_sessions"
    __table_args__ = (Index("ix_study_sessions_user", "user_id", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # app sinh ra, để gửi lại không bị ghi trùng
    client_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    list_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("word_lists.id", ondelete="SET NULL")
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # xem 9.2
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    correct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
