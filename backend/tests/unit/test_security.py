import hashlib
import re
import uuid

import pytest

from app.core import security
from app.core.errors import AppError
from tests.conftest import FakeClock


def test_hash_and_verify_password() -> None:
    hashed = security.hash_password("matkhau-123")

    assert hashed.startswith("$argon2")
    assert security.verify_password("matkhau-123", hashed)[0] is True
    assert security.verify_password("sai", hashed)[0] is False


def test_access_token_roundtrip(clock: FakeClock) -> None:
    user_id = uuid.uuid4()
    token, expires_in = security.create_access_token(user_id)

    assert expires_in == 15 * 60
    assert security.decode_access_token(token) == user_id


def test_access_token_expires_by_fake_clock(clock: FakeClock) -> None:
    token, _ = security.create_access_token(uuid.uuid4())
    clock.advance(minutes=15)

    with pytest.raises(AppError) as exc_info:
        security.decode_access_token(token)
    assert exc_info.value.code == "TOKEN_EXPIRED"


def test_refresh_token_hash_is_sha256_hex() -> None:
    raw = security.new_refresh_token()

    assert len(raw) >= 64
    assert re.fullmatch(r"[0-9a-f]{64}", security.hash_refresh_token(raw))
    assert security.hash_refresh_token(raw) == security.hash_refresh_token(raw)


def test_new_reset_code_is_six_digits() -> None:
    codes = {security.new_reset_code() for _ in range(200)}

    assert all(re.fullmatch(r"[0-9]{6}", code) for code in codes)
    assert len(codes) > 150  # ngẫu nhiên, không lặp một giá trị


def test_new_reset_code_keeps_leading_zeros(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security.secrets, "randbelow", lambda _: 42)

    assert security.new_reset_code() == "000042"


def test_hash_reset_code_is_keyed_per_user() -> None:
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    hashed = security.hash_reset_code(user_a, "123456")

    assert len(hashed) == 64
    assert hashed == security.hash_reset_code(user_a, "123456")
    assert hashed != security.hash_reset_code(user_b, "123456")
    assert hashed != hashlib.sha256(b"123456").hexdigest()  # không phải SHA-256 thuần
    assert security.reset_code_matches(hashed, user_a, "123456")
    assert not security.reset_code_matches(hashed, user_a, "123457")
    assert not security.reset_code_matches(hashed, user_b, "123456")
