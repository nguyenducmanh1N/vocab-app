import logging

import pytest

from app.clients.email import LogEmailSender


async def test_log_sender_shows_code_only_in_development(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="app.clients.email"):
        await LogEmailSender(show_body=True).send("an@example.com", "Mã", "mã là 123456")
        await LogEmailSender(show_body=False).send("an@example.com", "Mã", "mã là 654321")

    assert "123456" in caplog.records[0].getMessage()
    assert "654321" not in caplog.records[1].getMessage()
    assert "an@example.com" not in caplog.records[1].getMessage()
