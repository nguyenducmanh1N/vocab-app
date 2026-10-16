from fastapi import APIRouter

from app.api.v1.routes import (
    ai,
    auth,
    categories,
    dictionary,
    health,
    lists,
    me,
    notifications,
    stats,
    study,
    words,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(categories.router)
api_router.include_router(lists.router)
api_router.include_router(words.router)
api_router.include_router(dictionary.router)
api_router.include_router(ai.router)
api_router.include_router(study.router)
api_router.include_router(stats.router)
api_router.include_router(notifications.router)
