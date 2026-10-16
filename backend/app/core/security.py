import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.time import now_utc

ALGORITHM = "HS256"
ACCESS_TOKEN_TYPE = "access"

password_hash = PasswordHash.recommended()  # Argon2


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> tuple[bool, str | None]:
    """Trả (đúng mật khẩu?, hash mới nếu cần nâng tham số hash)."""
    return password_hash.verify_and_update(password, hashed)


def token_invalid() -> AppError:
    return AppError(401, "TOKEN_INVALID", "Phiên đăng nhập không hợp lệ")


def create_access_token(user_id: uuid.UUID) -> tuple[str, int]:
    """Tạo JWT access token; trả (token, số giây còn hiệu lực)."""
    settings = get_settings()
    issued_at = now_utc()
    expires_in = settings.access_token_minutes * 60
    payload = {
        "sub": str(user_id),
        "type": ACCESS_TOKEN_TYPE,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM), expires_in


def decode_access_token(token: str) -> uuid.UUID:
    """Giải access token; lỗi ném AppError 401 TOKEN_EXPIRED hoặc TOKEN_INVALID."""
    try:
        # exp/iat tự so với now_utc() bên dưới để test giả được đồng hồ.
        payload: dict[str, Any] = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=[ALGORITHM],
            options={
                "require": ["sub", "type", "iat", "exp"],
                "verify_exp": False,
                "verify_iat": False,
            },
        )
    except jwt.PyJWTError as exc:
        raise token_invalid() from exc

    if payload.get("type") != ACCESS_TOKEN_TYPE or not isinstance(payload.get("exp"), int):
        raise token_invalid()
    if payload["exp"] <= now_utc().timestamp():
        raise AppError(401, "TOKEN_EXPIRED", "Phiên đăng nhập đã hết hạn")
    try:
        return uuid.UUID(str(payload["sub"]))
    except ValueError as exc:
        raise token_invalid() from exc


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """SHA-256 hex; DB chỉ lưu giá trị này, không lưu token gốc."""
    return hashlib.sha256(token.encode()).hexdigest()


RESET_CODE_DIGITS = 6


def new_reset_code() -> str:
    """Mã OTP 6 chữ số, giữ số 0 ở đầu."""
    return f"{secrets.randbelow(10**RESET_CODE_DIGITS):0{RESET_CODE_DIGITS}d}"


def hash_reset_code(user_id: uuid.UUID, code: str) -> str:
    """HMAC-SHA256 hex với khoá JWT_SECRET; mã chỉ có 10^6 khả năng nên SHA-256 thuần dò được."""
    message = f"{user_id}:{code}".encode()
    return hmac.new(get_settings().jwt_secret.encode(), message, hashlib.sha256).hexdigest()


def reset_code_matches(code_hash: str, user_id: uuid.UUID, code: str) -> bool:
    """So mã theo thời gian cố định."""
    return hmac.compare_digest(code_hash, hash_reset_code(user_id, code))
