"""Đổi connection string của Neon/Supabase sang dạng SQLAlchemy + asyncpg (PLAN.md 13.1).

Đọc URL từ stdin, in URL đã đổi ra stdout (không ghi file). Ví dụ (macOS, URL đang ở clipboard):
    pbpaste | uv run python scripts/to_asyncpg_url.py | pbcopy
    DATABASE_URL="$(pbpaste | uv run python scripts/to_asyncpg_url.py)" uv run alembic upgrade head
"""

import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# asyncpg không nhận các tham số kiểu libpq này
DROP_PARAMS = {"sslmode", "channel_binding"}


def to_asyncpg_url(url: str) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme not in {"postgres", "postgresql", "postgresql+asyncpg"}:
        raise ValueError("Không phải connection string PostgreSQL")
    if parts.hostname and "-pooler" in parts.hostname:
        raise ValueError("Đây là URL qua pooler; hãy lấy URL kết nối trực tiếp (13.1)")
    params = [(k, v) for k, v in parse_qsl(parts.query) if k not in DROP_PARAMS]
    params.append(("ssl", "require"))
    return urlunsplit(("postgresql+asyncpg", parts.netloc, parts.path, urlencode(params), ""))


if __name__ == "__main__":
    try:
        print(to_asyncpg_url(sys.stdin.read()))
    except ValueError as exc:
        sys.exit(f"Lỗi: {exc}")
