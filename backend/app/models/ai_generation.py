import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AiGeneration(Base):
    """Mỗi lần gọi AI (gợi ý, tự điền, nhận xét luyện nói); dùng để tính hạn mức và cache (9.7)."""

    __tablename__ = "ai_generations"
    __table_args__ = (
        CheckConstraint("kind IN ('suggest','enrich','speaking')", name="kind"),
        CheckConstraint("status IN ('ok','error')", name="status"),
        Index("ix_ai_generations_cache", "cache_key", text("created_at DESC")),
        Index("ix_ai_generations_user_time", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    topic: Mapped[str | None] = mapped_column(String(200))
    # topic_key|level|count|word_types, chỉ cho suggest
    cache_key: Mapped[str | None] = mapped_column(String(300))
    level: Mapped[str | None] = mapped_column(String(2))
    word_count: Mapped[int | None] = mapped_column(Integer)
    model: Mapped[str] = mapped_column(String(60), nullable=False)  # 'cache' khi lấy lại kết quả cũ
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    result: Mapped[Any] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
