import uuid
from datetime import datetime
from typing import Annotated, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

# Kiểu và miền giá trị theo PLAN.md 7.3; dùng chung cho bản đầy đủ và bản PATCH.
HHMM = Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
DailyNewWords = Annotated[int, Field(ge=0, le=50)]
MaxReviewsPerDay = Annotated[int, Field(ge=10, le=500)]
DailyGoalCards = Annotated[int, Field(ge=10, le=300)]  # ≥ ngưỡng streak ở 9.5
CardDirection = Literal["en_vi", "vi_en"]
Voice = Literal["en-US", "en-GB"]
SpeechRate = Annotated[float, Field(ge=0.5, le=1.0)]
Theme = Literal["system", "light", "dark"]
WordPushPerDay = Annotated[int, Field(ge=0, le=10)]

Level = Literal["A1", "A2", "B1", "B2", "C1", "C2"]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]


def _check_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Múi giờ không hợp lệ") from exc
    return value


Timezone = Annotated[str, StringConstraints(max_length=64), AfterValidator(_check_timezone)]


class NotifySettings(BaseModel):
    daily_reminder: bool = True
    reminder_time: HHMM = "20:00"
    word_push: bool = True
    word_push_per_day: WordPushPerDay = 3
    window_start: HHMM = "08:00"
    window_end: HHMM = "22:00"
    streak_guard: bool = True

    @model_validator(mode="after")
    def check_window(self) -> Self:
        # Chuỗi HH:MM so sánh được theo thứ tự từ điển.
        if self.window_start >= self.window_end:
            raise ValueError("window_start phải trước window_end")
        return self


class UserSettings(BaseModel):
    """users.settings theo PLAN.md 7.3; khoá thiếu lấy giá trị mặc định."""

    daily_new_words: DailyNewWords = 10
    max_reviews_per_day: MaxReviewsPerDay = 100
    daily_goal_cards: DailyGoalCards = 20
    card_direction: CardDirection = "en_vi"
    voice: Voice = "en-US"
    speech_rate: SpeechRate = 0.9
    auto_play_audio: bool = True
    theme: Theme = "system"
    notify: NotifySettings = Field(default_factory=NotifySettings)


class NotifySettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    daily_reminder: bool | None = None
    reminder_time: HHMM | None = None
    word_push: bool | None = None
    word_push_per_day: WordPushPerDay | None = None
    window_start: HHMM | None = None
    window_end: HHMM | None = None
    streak_guard: bool | None = None


class UserSettingsPatch(BaseModel):
    """Một phần của settings; gộp vào giá trị đang lưu rồi validate lại bằng UserSettings."""

    model_config = ConfigDict(extra="forbid")

    daily_new_words: DailyNewWords | None = None
    max_reviews_per_day: MaxReviewsPerDay | None = None
    daily_goal_cards: DailyGoalCards | None = None
    card_direction: CardDirection | None = None
    voice: Voice | None = None
    speech_rate: SpeechRate | None = None
    auto_play_audio: bool | None = None
    theme: Theme | None = None
    notify: NotifySettingsPatch | None = None


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: DisplayName | None = None
    level: Level | None = None
    timezone: Timezone | None = None
    settings: UserSettingsPatch | None = None

    @model_validator(mode="after")
    def reject_explicit_null(self) -> Self:
        for name in ("display_name", "level", "timezone", "settings"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} không được để null")
        return self


class AccountDelete(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    level: str
    timezone: str
    settings: UserSettings
    ai_consent_at: datetime | None
    ai_consent_version: int | None
    created_at: datetime

    @field_validator("settings", mode="before")
    @classmethod
    def fill_settings_defaults(cls, value: object) -> object:
        return UserSettings.model_validate(value or {})


class AiConsentIn(BaseModel):
    """accepted = false là rút lại đồng ý (PLAN.md 9.16)."""

    model_config = ConfigDict(extra="forbid")

    accepted: bool


class AiConsentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ai_consent_at: datetime | None
    ai_consent_version: int | None
