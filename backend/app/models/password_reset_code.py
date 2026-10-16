import uuid
from datetime import datetime

from sqlalchemy import CHAR, DateTime, ForeignKey, Index, SmallInteger, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin


class PasswordResetCode(CreatedAtMixin, Base):
    """Mã OTP quên mật khẩu (PLAN.md 9.1); chỉ lưu HMAC của mã, không lưu mã gốc."""

    __tablename__ = "password_reset_codes"
    __table_args__ = (Index("ix_password_reset_codes_user", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
