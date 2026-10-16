import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    SmallInteger,
    String,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ReviewLog(Base):
    """Mỗi câu trả lời đã chấm (PLAN.md 9.2); đủ dữ liệu để sau này chuyển sang FSRS."""

    __tablename__ = "review_logs"
    __table_args__ = (
        CheckConstraint("quality BETWEEN 0 AND 5", name="quality"),
        Index("ix_review_logs_user_time", "user_id", "reviewed_at"),
        Index("ix_review_logs_word", "word_id"),
        Index("ix_review_logs_session_word", "session_id", "word_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    word_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("words.id", ondelete="CASCADE"), nullable=False
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("study_sessions.id", ondelete="CASCADE"), nullable=False
    )
    client_answer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    quality: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # giá trị server đã chốt ở 9.4, không phải giá trị app gửi
    is_first_attempt: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # true nếu câu trả lời này đã cập nhật lịch ôn
    counted_for_srs: Mapped[bool] = mapped_column(Boolean, nullable=False)
    response_ms: Mapped[int | None] = mapped_column(Integer)
    interval_before: Mapped[int | None] = mapped_column(Integer)
    interval_after: Mapped[int | None] = mapped_column(Integer)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
