from collections.abc import AsyncIterator, Iterator, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import app.models  # noqa: F401  # đăng ký model vào Base.metadata để clean_db thấy mọi bảng
from app.api.v1.deps import (
    get_ai_client,
    get_dictionary_client,
    get_email_sender,
    get_session_factory,
)
from app.clients.gemini import GeminiClient, upstream_error
from app.core import time as app_time
from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> None:
    """Chạy `alembic upgrade head` lên vocab_test một lần mỗi phiên test.

    env.py tự gọi asyncio.run(), nên chạy trong thread riêng để không đụng event loop của
    pytest-asyncio.
    """
    config = Config(BACKEND_DIR / "alembic.ini")
    config.attributes["sqlalchemy.url"] = get_settings().test_database_url
    config.attributes["configure_logger"] = False
    with ThreadPoolExecutor(max_workers=1) as executor:
        executor.submit(command.upgrade, config, "head").result()


@pytest.fixture(scope="session")
async def test_engine(migrated_db: None) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(get_settings().test_database_url)
    yield engine
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean_db(test_engine: AsyncEngine) -> None:
    """Xoá dữ liệu mọi bảng trong metadata trước mỗi test."""
    tables = Base.metadata.sorted_tables
    if not tables:
        return
    preparer = test_engine.dialect.identifier_preparer
    names = ", ".join(preparer.format_table(table) for table in tables)
    async with test_engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture
def app(test_engine: AsyncEngine, fake_ai: "FakeAi", fake_mailer: "FakeEmailSender") -> FastAPI:
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def get_test_db() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    application = create_app()
    application.dependency_overrides[get_db] = get_test_db
    application.dependency_overrides[get_session_factory] = lambda: session_factory
    # Không bao giờ gọi Gemini thật trong test (PLAN.md 12.1).
    application.dependency_overrides[get_ai_client] = lambda: fake_ai
    application.dependency_overrides[get_email_sender] = lambda: fake_mailer
    return application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@dataclass(frozen=True)
class SentEmail:
    to: str
    subject: str
    body: str


class FakeEmailSender:
    """Bản giả của SmtpEmailSender: không gửi thật, ghi lại mail vào outbox."""

    def __init__(self) -> None:
        self.outbox: list[SentEmail] = []

    async def send(self, to: str, subject: str, body: str) -> None:
        self.outbox.append(SentEmail(to=to, subject=subject, body=body))


@pytest.fixture
def fake_mailer() -> FakeEmailSender:
    return FakeEmailSender()


@pytest.fixture
def outbox(fake_mailer: FakeEmailSender) -> list[SentEmail]:
    return fake_mailer.outbox


class FakeClock:
    """Đồng hồ giả cho now_utc(); bắt đầu từ thời điểm thật, chỉ đổi khi gọi advance/set."""

    def __init__(self) -> None:
        self.current = datetime.now(UTC).replace(microsecond=0)

    def __call__(self) -> datetime:
        return self.current

    def advance(self, **delta: float) -> None:
        self.current += timedelta(**delta)

    def set(self, value: datetime) -> None:
        self.current = value


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> FakeClock:
    fake = FakeClock()
    monkeypatch.setattr(app_time, "_now_provider", fake)
    return fake


@pytest.fixture(autouse=True)
def reset_rate_limits() -> Iterator[None]:
    """Bộ đếm slowapi nằm trong bộ nhớ và dùng chung cho mọi app; xoá để test không dính 429."""
    limiter.reset()
    get_dictionary_client().reset()  # cầu dao từ điển dùng chung cho mọi app
    yield
    limiter.reset()


TEST_PASSWORD = "matkhau-dung-123"


async def register_user(client: AsyncClient, email: str, display_name: str) -> dict[str, Any]:
    """Đăng ký user qua API; trả {user, tokens, headers} để gọi endpoint cần đăng nhập."""
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": TEST_PASSWORD, "display_name": display_name},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return {
        "user": body["user"],
        "tokens": body["tokens"],
        "headers": {"Authorization": f"Bearer {body['tokens']['access_token']}"},
    }


@pytest.fixture
async def auth(client: AsyncClient) -> dict[str, Any]:
    """User A, dùng cho hầu hết test."""
    return await register_user(client, "an@example.com", "An")


@pytest.fixture
async def other_auth(client: AsyncClient) -> dict[str, Any]:
    """User B, để kiểm tra dữ liệu của người khác trả 404."""
    return await register_user(client, "binh@example.com", "Bình")


async def accept_ai_consent(client: AsyncClient, auth: dict[str, Any]) -> dict[str, Any]:
    """User đồng ý dùng AI (PLAN.md 9.16); test gọi /ai/* cần bước này. Trả lại `auth`."""
    response = await client.post(
        "/api/v1/me/ai-consent", json={"accepted": True}, headers=auth["headers"]
    )
    assert response.status_code == 200, response.text
    return auth


FIXTURES_DIR = BACKEND_DIR / "tests" / "fixtures"


class FakeAi:
    """Bản giả của GeminiClient: trả JSON trong tests/fixtures/, ghi lại prompt đã nhận."""

    def __init__(self) -> None:
        self.fixture: str | None = "gemini_suggest.json"  # test Tự điền đổi sang gemini_enrich.json
        self.fail = False
        self.model = "fake-model"
        self.prompts: list[str] = []
        self.images: list[list[Any]] = []
        self.audio: list[list[Any]] = []
        # JSON trả cho từng schema (theo tên lớp), ưu tiên hơn `fixture`; luyện nói gọi 2 schema.
        self.json_by_schema: dict[str, str] = {}

    async def generate(
        self,
        prompt: str,
        schema: type[Any],
        images: Sequence[Any] = (),
        audio: Sequence[Any] = (),
    ) -> tuple[Any, str]:
        self.prompts.append(prompt)
        self.images.append(list(images))
        self.audio.append(list(audio))
        if self.fail:
            raise upstream_error()
        text = self.json_by_schema.get(schema.__name__)
        if text is None:
            if self.fixture is None:
                raise upstream_error()
            text = (FIXTURES_DIR / self.fixture).read_text()
        return schema.model_validate_json(text), self.model


@pytest.fixture
def fake_ai() -> FakeAi:
    return FakeAi()


@pytest.fixture(autouse=True)
def block_real_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    """Chặn mọi lời gọi Gemini thật: test nào lỡ gọi sẽ báo lỗi (PLAN.md 12.1).

    Test của GeminiClient tự thay _generate bằng bản giả của riêng nó.
    """

    async def blocked(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("Test không được gọi Gemini thật")

    monkeypatch.setattr(GeminiClient, "_generate", blocked)
