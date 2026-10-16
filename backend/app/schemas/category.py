import uuid
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

CategoryName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Icon = Annotated[str, StringConstraints(max_length=40, pattern=r"^[a-z0-9-]+$")]  # tên Ionicons
Color = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")]


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName
    icon: Icon = "folder"
    color: Color = "#5B5BD6"


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CategoryName | None = None
    icon: Icon | None = None
    color: Color | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100_000)
    is_pinned: bool | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> Self:
        for name in self.model_fields_set:
            if getattr(self, name) is None:
                raise ValueError(f"{name} không được để null")
        return self


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    icon: str
    color: str
    sort_order: int
    is_pinned: bool
    list_count: int
