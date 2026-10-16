import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

ListName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
ListSource = Literal["manual", "ai", "import"]


class ListCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ListName
    category_id: uuid.UUID | None = None
    description: Description | None = None
    source: ListSource = "manual"
    ai_topic: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None


class ListUpdate(BaseModel):
    """category_id = null đưa list về "Chưa phân loại"; description = null xoá mô tả."""

    model_config = ConfigDict(extra="forbid")

    name: ListName | None = None
    description: Description | None = None
    category_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def reject_null_name(self) -> Self:
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name không được để null")
        return self


class ListFilters(BaseModel):
    category_id: uuid.UUID | None = None
    uncategorized: bool = False
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = Field(
        default=None
    )

    @model_validator(mode="after")
    def check_exclusive(self) -> Self:
        if self.category_id is not None and self.uncategorized:
            raise ValueError("Không dùng cùng lúc category_id và uncategorized")
        return self


class ListOut(BaseModel):
    id: uuid.UUID
    category_id: uuid.UUID | None
    name: str
    description: str | None
    source: str
    ai_topic: str | None
    word_count: int
    mastered_count: int
    due_count: int
    created_at: datetime
    updated_at: datetime
