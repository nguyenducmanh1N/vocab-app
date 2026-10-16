"""Helper dùng chung cho test phiên học (queue, sessions)."""

from datetime import timedelta
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import Word, WordProgress
from tests.conftest import FakeClock

TZ = "Asia/Ho_Chi_Minh"  # múi giờ mặc định của user
DAY = timedelta(days=1)


async def new_list(client: AsyncClient, auth: dict[str, Any], name: str = "List") -> str:
    response = await client.post("/api/v1/lists", json={"name": name}, headers=auth["headers"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def set_settings(client: AsyncClient, auth: dict[str, Any], **settings: Any) -> None:
    response = await client.patch(
        "/api/v1/me", json={"settings": settings}, headers=auth["headers"]
    )
    assert response.status_code == 200, response.text


class Seeder:
    """Ghi thẳng Word + WordProgress để chọn được due_at, created_at… theo đồng hồ giả."""

    def __init__(self, engine: AsyncEngine, clock: FakeClock, user_id: str) -> None:
        self.engine = engine
        self.clock = clock
        self.user_id = user_id
        self.order = 0  # created_at tăng dần theo thứ tự thêm

    async def word(
        self,
        list_id: str,
        term: str,
        *,
        due: timedelta | None = None,
        interval: int = 0,
        last_reviewed: timedelta | None = None,
        starred: bool = False,
    ) -> str:
        """`due`, `last_reviewed` tính từ now; due=None là từ mới."""
        now = self.clock.current
        self.order += 1
        async with AsyncSession(self.engine) as session:
            word = Word(
                user_id=self.user_id,
                list_id=list_id,
                term=term,
                meaning_vi=f"nghĩa {term}",
                is_starred=starred,
                created_at=now - timedelta(days=30) + timedelta(seconds=self.order),
            )
            session.add(word)
            await session.flush()
            word_id = str(word.id)  # đọc trước commit: sau commit object hết hạn (MissingGreenlet)
            session.add(
                WordProgress(
                    word_id=word.id,
                    user_id=self.user_id,
                    interval_days=interval if due is not None else 0,
                    repetitions=1 if due is not None else 0,
                    due_at=None if due is None else now + due,
                    last_reviewed_at=None if last_reviewed is None else now + last_reviewed,
                )
            )
            await session.commit()
            return word_id
