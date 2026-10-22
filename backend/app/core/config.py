from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    env: str = "development"
    database_url: str = "postgresql+asyncpg://vocab:vocab@localhost:5432/vocab"
    test_database_url: str = "postgresql+asyncpg://vocab:vocab@localhost:5432/vocab_test"
    jwt_secret: str
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_fallback_model: str = "gemini-3.8-flash"
    ai_suggest_daily_limit: int = 20
    ai_enrich_daily_limit: int = 100
    ai_speaking_daily_limit: int = 30
    ai_insight_daily_limit: int = 50
    ai_consent_version: int = 1  # tăng khi nội dung màn đồng ý đổi → người dùng được hỏi lại
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:8081"]
    log_level: str = "INFO"
    smtp_host: str = ""  # trống: không gửi mail, chỉ ghi log (xem app/clients/email.py)
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    smtp_from: str = "VocabTopic <no-reply@example.com>"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # jwt_secret đọc từ .env
