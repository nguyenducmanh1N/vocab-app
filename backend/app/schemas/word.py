import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.core.levels import Level
from app.core.text import collapse_spaces
from app.schemas.common import PageParams

# Giới hạn độ dài theo PLAN.md 8.2.
Term = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(collapse_spaces),
]
MeaningVi = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
PartOfSpeech = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=20)
]
Ipa = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
Synonym = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
AudioUrl = Annotated[str, StringConstraints(max_length=500, pattern=r"^https?://\S+$")]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
# Tối đa 3 định nghĩa tiếng Anh từ từ điển, mỗi dòng một định nghĩa.
DefinitionEn = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1500)]
ExampleText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
ExampleSource = Literal["ai", "user", "tatoeba", "text", "image"]
SourceId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
SourceUrl = Annotated[str, StringConstraints(max_length=500, pattern=r"^https?://\S+$")]
Mnemonic = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class Example(BaseModel):
    model_config = ConfigDict(extra="forbid")

    en: ExampleText
    vi: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] = ""
    source: ExampleSource | None = None
    source_id: SourceId | None = None  # id câu trên Tatoeba (gửi dạng chuỗi)
    source_url: SourceUrl | None = None


class FamilyItem(BaseModel):
    """Một dạng khác cùng gốc của từ (decide -> decision)."""

    model_config = ConfigDict(extra="forbid")

    term: Term
    part_of_speech: PartOfSpeech
    meaning_vi: MeaningVi
    example_en: ExampleText


class Collocation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phrase: Term
    meaning_vi: MeaningVi
    example_en: ExampleText


class Confusable(BaseModel):
    """Từ hay bị nhầm với từ đang học, kèm cách phân biệt."""

    model_config = ConfigDict(extra="forbid")

    term: Term
    difference_vi: MeaningVi
    example_en: ExampleText
    other_example_en: ExampleText


class WordCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term: Term
    meaning_vi: MeaningVi
    definition_en: DefinitionEn | None = None
    part_of_speech: PartOfSpeech | None = None
    ipa: Ipa | None = None
    synonyms: list[Synonym] = Field(default_factory=list, max_length=5)
    examples: list[Example] = Field(default_factory=list, max_length=5)
    audio_url: AudioUrl | None = None
    note: Note | None = None
    is_starred: bool = False
    mnemonic: Mnemonic | None = None
    word_family: list[FamilyItem] = Field(default_factory=list, max_length=5)
    collocations: list[Collocation] = Field(default_factory=list, max_length=5)
    confusables: list[Confusable] = Field(default_factory=list, max_length=2)


# Trường được phép đặt null khi PATCH (xoá giá trị); các trường khác null → 422.
NULLABLE_FIELDS = {"part_of_speech", "ipa", "audio_url", "note", "definition_en", "mnemonic"}


class WordUpdate(BaseModel):
    """Mọi trường của WordCreate (tuỳ chọn) + list_id để chuyển sang list khác."""

    model_config = ConfigDict(extra="forbid")

    term: Term | None = None
    meaning_vi: MeaningVi | None = None
    definition_en: DefinitionEn | None = None
    part_of_speech: PartOfSpeech | None = None
    ipa: Ipa | None = None
    synonyms: list[Synonym] | None = Field(default=None, max_length=5)
    examples: list[Example] | None = Field(default=None, max_length=5)
    audio_url: AudioUrl | None = None
    note: Note | None = None
    is_starred: bool | None = None
    mnemonic: Mnemonic | None = None
    word_family: list[FamilyItem] | None = Field(default=None, max_length=5)
    collocations: list[Collocation] | None = Field(default=None, max_length=5)
    confusables: list[Confusable] | None = Field(default=None, max_length=2)
    list_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def reject_null(self) -> Self:
        for name in self.model_fields_set - NULLABLE_FIELDS:
            if getattr(self, name) is None:
                raise ValueError(f"{name} không được để null")
        return self


class BulkCreate(BaseModel):
    words: list[WordCreate] = Field(min_length=1, max_length=100)


class WordFilters(PageParams):
    level: Level | None = None
    starred: bool | None = None
    q: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None


class SearchParams(BaseModel):
    q: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    limit: int = Field(default=20, ge=1, le=50)


class ProgressOut(BaseModel):
    level: Level
    due_at: datetime | None
    interval_days: int
    repetitions: int
    lapses: int
    is_leech: bool
    correct_count: int
    wrong_count: int
    last_reviewed_at: datetime | None


class WordOut(BaseModel):
    id: uuid.UUID
    list_id: uuid.UUID
    term: str
    part_of_speech: str | None
    ipa: str | None
    meaning_vi: str
    definition_en: str | None
    synonyms: list[str]
    examples: list[Example]
    audio_url: str | None
    note: str | None
    is_starred: bool
    progress: ProgressOut
    mnemonic: str | None
    word_family: list[FamilyItem]
    collocations: list[Collocation]
    confusables: list[Confusable]
    created_at: datetime
    updated_at: datetime


class WordSearchOut(WordOut):
    list_name: str


class SkippedWord(BaseModel):
    term: str
    reason: str


class BulkOut(BaseModel):
    created: list[WordOut]
    skipped: list[SkippedWord]
