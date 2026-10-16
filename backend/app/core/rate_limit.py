from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.errors import error_response

# Bộ đếm trong bộ nhớ, theo IP. Khi chạy sau proxy cần `uvicorn --proxy-headers` để lấy đúng IP.
limiter = Limiter(key_func=get_remote_address)


async def rate_limit_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RateLimitExceeded)
    return error_response(
        429,
        "RATE_LIMITED",
        "Bạn thao tác quá nhanh, vui lòng thử lại sau",
        {"limit": str(exc.detail)},
    )
