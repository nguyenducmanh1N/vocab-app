import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, false, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DailyActivity(Base):
    """Thống kê theo ngày; chỉ đếm lần chấm đầu của mỗi từ trong phiên (PLAN.md 9.4)."""

    __tablename__ = "daily_activity"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    activity_date: Mapped[date] = mapped_column(Date, primary_key=True)  # ngày theo múi giờ user
    cards_done: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    new_words: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    correct: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    study_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    goal_met: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
