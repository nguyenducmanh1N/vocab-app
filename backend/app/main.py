from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded

from app.api.v1.deps import get_dictionary_client, get_suggest_client
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.rate_limit import limiter, rate_limit_handler


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    if get_dictionary_client.cache_info().currsize:  # chỉ đóng nếu đã tạo
        await get_dictionary_client().aclose()
    if get_suggest_client.cache_info().currsize:
        await get_suggest_client().aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="VocabTopic API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
    app.include_router(api_router)
    return app


app = create_app()
