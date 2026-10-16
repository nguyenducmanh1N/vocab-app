import uuid

from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


async def get_by_id(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)


async def get_by_email(session: AsyncSession, email: str) -> User | None:
    """`email` phải đã chuẩn hoá chữ thường. Chỉ dùng cho đăng ký/đăng nhập."""
    return await session.scalar(select(User).where(User.email == email))


async def add(session: AsyncSession, user: User) -> User:
    session.add(user)
    await session.flush()
    await session.refresh(user)  # lấy id, created_at, giá trị mặc định phía server
    return user


async def get_by_email_for_update(session: AsyncSession, email: str) -> User | None:
    """Khoá dòng user để hai request xin mã quên mật khẩu cùng lúc không cùng tạo mã."""
    return await session.scalar(select(User).where(User.email == email).with_for_update())


async def delete(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Một lệnh DELETE; mọi bảng tham chiếu users đều ON DELETE CASCADE (PLAN.md 7.2)."""
    await session.execute(sa_delete(User).where(User.id == user_id))
