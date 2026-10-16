import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

import app.models  # noqa: F401  # đăng ký model vào Base.metadata cho autogenerate
from app.core.config import get_settings
from app.db.base import Base

config = context.config

# Test gọi alembic.command với configure_logger=False để không ghi đè logging của pytest.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Test truyền URL vocab_test qua attributes; mặc định lấy DATABASE_URL từ Settings.
database_url: str = config.attributes.get("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    """Sinh SQL ra stdout (alembic upgrade --sql) mà không cần kết nối DB."""
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = create_async_engine(database_url, poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
