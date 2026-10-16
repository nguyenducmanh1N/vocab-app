# Backend VocabTopic (PLAN.md 13.2). Biến môi trường (DATABASE_URL, JWT_SECRET…) khai báo trên host,
# không đưa vào image.
FROM python:3.12-slim
# Ghim bản uv trùng bản dùng khi dev để build lặp lại được
COPY --from=ghcr.io/astral-sh/uv:0.9.24 /uv /uvx /bin/
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
ENV PATH="/app/.venv/bin:$PATH"
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
