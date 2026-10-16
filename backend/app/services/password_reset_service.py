"""Quên mật khẩu qua mã OTP gửi email (PLAN.md 9.1).

Không để lộ email có tồn tại hay không: xin mã luôn trả 204 ngay, phần việc thật chạy ở nền
(giới hạn theo tài khoản bỏ qua âm thầm); đặt lại mật khẩu chỉ có một lỗi INVALID_RESET_CODE.
"""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.clients.email import EmailSender
from app.core import security
from app.core.errors import AppError
from app.core.time import now_utc
from app.models import PasswordResetCode
from app.repositories import password_reset_code_repository as code_repo
from app.repositories import refresh_token_repository as token_repo
from app.repositories import user_repository as user_repo
from app.schemas.auth import AuthOut, ResetPasswordIn
from app.schemas.user import UserOut
from app.services.auth_service import issue_tokens

CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5  # lần sai thứ 5 vô hiệu mã
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_CODES_PER_HOUR = 5

# Khi email không tồn tại vẫn tính và so HMAC để mọi nhánh tốn công như nhau.
_DUMMY_USER_ID = uuid.UUID(int=0)
_DUMMY_CODE_HASH = "0" * 64


@dataclass(frozen=True)
class ResetEmail:
    to: str
    subject: str
    body: str


def _invalid_code() -> AppError:
    return AppError(400, "INVALID_RESET_CODE", "Mã không đúng hoặc đã hết hạn")


def _reset_email(to: str, display_name: str, code: str) -> ResetEmail:
    minutes = int(CODE_TTL.total_seconds() // 60)
    body = (
        f"Xin chào {display_name},\n\n"
        f"Mã đặt lại mật khẩu VocabTopic của bạn là: {code}\n\n"
        f"Mã có hiệu lực trong {minutes} phút. Đừng chia sẻ mã này với ai.\n"
        "Nếu không phải bạn yêu cầu, hãy bỏ qua email này; mật khẩu của bạn vẫn giữ nguyên.\n"
    )
    return ResetEmail(to=to, subject="Mã đặt lại mật khẩu VocabTopic", body=body)


async def request_code(session: AsyncSession, email: str) -> ResetEmail | None:
    """Tạo mã mới và trả mail cần gửi; None nếu không có tài khoản hoặc đã vượt giới hạn."""
    user = await user_repo.get_by_email_for_update(session, email)
    if user is None:
        return None

    now = now_utc()
    latest = await code_repo.latest_created_at(session, user.id)
    if latest is not None and now - latest < RESEND_COOLDOWN:
        return None
    if (
        await code_repo.count_since(session, user.id, now - timedelta(hours=1))
        >= MAX_CODES_PER_HOUR
    ):
        return None

    code = security.new_reset_code()
    await code_repo.invalidate_all(session, user.id, now)  # mỗi user chỉ một mã còn hiệu lực
    await code_repo.add(
        session,
        PasswordResetCode(
            user_id=user.id,
            code_hash=security.hash_reset_code(user.id, code),
            expires_at=now + CODE_TTL,
            created_at=now,  # theo now_utc() để giới hạn tần suất test được bằng đồng hồ giả
        ),
    )
    await session.commit()
    return _reset_email(user.email, user.display_name, code)


async def request_code_and_send(
    session_factory: async_sessionmaker[AsyncSession], mailer: EmailSender, email: str
) -> None:
    """Chạy ở nền sau khi đã trả 204 (BackgroundTasks), với session riêng."""
    async with session_factory() as session:
        mail = await request_code(session, email)
    if mail is not None:
        await mailer.send(mail.to, mail.subject, mail.body)


async def reset_password(session: AsyncSession, data: ResetPasswordIn) -> AuthOut:
    """Đúng mã: đặt mật khẩu mới, thu hồi mọi refresh token, cấp family mới (như đăng nhập)."""
    user = await user_repo.get_by_email(session, data.email)
    if user is None:
        security.reset_code_matches(_DUMMY_CODE_HASH, _DUMMY_USER_ID, data.code)
        raise _invalid_code()

    now = now_utc()
    record = await code_repo.latest_unused_for_update(session, user.id)
    if record is None or record.expires_at <= now:
        security.reset_code_matches(_DUMMY_CODE_HASH, user.id, data.code)
        raise _invalid_code()

    if not security.reset_code_matches(record.code_hash, user.id, data.code):
        record.attempts += 1
        if record.attempts >= MAX_ATTEMPTS:
            record.used_at = now
        await session.commit()
        raise _invalid_code()

    record.used_at = now
    user.password_hash = security.hash_password(data.new_password)
    await token_repo.revoke_all_for_user(session, user.id, now)
    tokens = await issue_tokens(session, user.id, uuid.uuid4(), data.device_name)
    await session.commit()
    return AuthOut(user=UserOut.model_validate(user), tokens=tokens)
