"""ai generations

Revision ID: b227e48c09fa
Revises: e34de2a7883a
Create Date: 2026-10-14 16:38:38.927530

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b227e48c09fa"
down_revision: str | Sequence[str] | None = "e34de2a7883a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_generations",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("topic", sa.String(length=200), nullable=True),
        sa.Column("cache_key", sa.String(length=300), nullable=True),
        sa.Column("level", sa.String(length=2), nullable=True),
        sa.Column("word_count", sa.Integer(), nullable=True),
        sa.Column("model", sa.String(length=60), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('suggest','enrich')", name=op.f("ai_generations_kind_check")),
        sa.CheckConstraint("status IN ('ok','error')", name=op.f("ai_generations_status_check")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("ai_generations_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("ai_generations_pkey")),
    )
    op.create_index(
        "ix_ai_generations_cache",
        "ai_generations",
        ["cache_key", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_index(
        "ix_ai_generations_user_time", "ai_generations", ["user_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_ai_generations_user_time", table_name="ai_generations")
    op.drop_index("ix_ai_generations_cache", table_name="ai_generations")
    op.drop_table("ai_generations")
