import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, SmallInteger, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("level IN ('A1','A2','B1','B2','C1','C2')", name="level"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)  # chữ thường
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    level: Mapped[str] = mapped_column(String(2), nullable=False, server_default="B1")
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="Asia/Ho_Chi_Minh"
    )
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )  # xem PLAN.md 7.3
    # Đồng ý dùng AI (PLAN.md 9.16); null = chưa đồng ý hoặc đã rút lại
    ai_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_consent_version: Mapped[int | None] = mapped_column(SmallInteger)
