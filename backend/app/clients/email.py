"""Gửi email (mã quên mật khẩu, PLAN.md 9.1) qua SMTP; chưa cấu hình SMTP thì chỉ ghi log."""

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 15


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, body: str) -> None: ...


class SmtpEmailSender:
    """smtplib của thư viện chuẩn, chạy trong thread để không chặn event loop."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def send(self, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = self._settings.smtp_from
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        try:
            await asyncio.to_thread(self._send_sync, message)
        except (smtplib.SMTPException, OSError) as exc:
            # Gửi ở nền sau khi đã trả response, nên chỉ ghi log (không ghi địa chỉ nhận).
            logger.warning("smtp: gửi mail lỗi: %r", exc)

    def _send_sync(self, message: EmailMessage) -> None:
        settings = self._settings
        context = ssl.create_default_context()
        smtp: smtplib.SMTP
        if settings.smtp_security == "ssl":
            smtp = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=SMTP_TIMEOUT_SECONDS,
                context=context,
            )
        else:
            smtp = smtplib.SMTP(
                settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS
            )
        with smtp:
            if settings.smtp_security == "starttls":
                smtp.starttls(context=context)
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)


class LogEmailSender:
    """Dùng khi SMTP_HOST trống. Chỉ ở development mới ghi nội dung (có mã) ra log để test tay."""

    def __init__(self, show_body: bool) -> None:
        self._show_body = show_body

    async def send(self, to: str, subject: str, body: str) -> None:
        if self._show_body:
            logger.warning("email (chưa cấu hình SMTP) tới %s: %s\n%s", to, subject, body)
        else:
            logger.warning("email: chưa cấu hình SMTP, bỏ qua mail %r", subject)
