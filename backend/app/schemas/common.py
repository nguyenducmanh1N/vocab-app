from pydantic import BaseModel, Field


class Page[T](BaseModel):
    """Kết quả phân trang theo PLAN.md 8.1."""

    items: list[T]
    total: int


class PageParams(BaseModel):
    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)
