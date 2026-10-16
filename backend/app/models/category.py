import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint, false, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, CreatedAtMixin


class Category(CreatedAtMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    icon: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default="folder"
    )  # tên icon Ionicons
    color: Mapped[str] = mapped_column(String(9), nullable=False, server_default="#5B5BD6")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
