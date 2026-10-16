"""Hồ sơ người dùng: đọc, cập nhật, xoá tài khoản (PLAN.md 7.3, 8.3)."""

from typing import Any

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.errors import AppError
from app.core.time import now_utc
from app.models import User
from app.repositories import user_repository as user_repo
from app.schemas.user import AccountDelete, UserSettings, UserUpdate


def merge_settings(stored: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Gộp theo từng khoá; object lồng (notify) cũng được gộp thay vì ghi đè."""
    merged = dict(stored)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_settings(merged[key], value)
        else:
            merged[key] = value
    return merged


def _validate_settings(settings: dict[str, Any]) -> None:
    """Kiểm tra bản đã gộp (vd. window_start < window_end); lỗi trả 422 như lỗi validate body."""
    try:
        UserSettings.model_validate(settings)
    except ValidationError as exc:
        errors = [{**err, "loc": ("body", "settings", *err["loc"])} for err in exc.errors()]
        raise RequestValidationError(errors) from exc


async def update_me(session: AsyncSession, user: User, data: UserUpdate) -> User:
    changes = data.model_dump(exclude_unset=True, exclude={"settings"})

    if data.settings is not None:
        # Chỉ lưu khoá người dùng đã đặt; khoá thiếu lấy mặc định khi đọc (UserOut).
        merged = merge_settings(user.settings, data.settings.model_dump(exclude_unset=True))
        _validate_settings(merged)
        changes["settings"] = merged  # dict mới để SQLAlchemy nhận ra JSONB đã đổi

    for field, value in changes.items():
        setattr(user, field, value)
    await session.commit()
    await session.refresh(user)
    return user


async def set_ai_consent(session: AsyncSession, user: User, accepted: bool, version: int) -> User:
    """Đồng ý: ghi thời điểm và phiên bản nội dung đã đồng ý; rút lại: cả hai về null (9.16)."""
    user.ai_consent_at = now_utc() if accepted else None
    user.ai_consent_version = version if accepted else None
    await session.commit()
    await session.refresh(user)
    return user


async def delete_account(session: AsyncSession, user: User, data: AccountDelete) -> None:
    """Sai mật khẩu → 401, không xoá gì. Đúng → xoá user, DB tự xoá cascade mọi dữ liệu của user."""
    ok, _ = security.verify_password(data.password, user.password_hash)
    if not ok:
        raise AppError(401, "INVALID_CREDENTIALS", "Mật khẩu không đúng")
    await user_repo.delete(session, user.id)
    await session.commit()
