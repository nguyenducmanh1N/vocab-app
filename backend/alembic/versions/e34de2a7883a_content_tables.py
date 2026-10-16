"""content tables

Revision ID: e34de2a7883a
Revises: a79e2e817973
Create Date: 2026-10-14 14:59:32.383760

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e34de2a7883a"
down_revision: str | Sequence[str] | None = "a79e2e817973"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dictionary_cache",
        sa.Column("term", sa.String(length=100), nullable=False),
        sa.Column("found", sa.Boolean(), nullable=False),
        sa.Column("ipa", sa.String(length=100), nullable=True),
        sa.Column("audio_url", sa.Text(), nullable=True),
        sa.Column("part_of_speech", sa.String(length=20), nullable=True),
        sa.Column(
            "definitions_en",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'"),
            nullable=False,
        ),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("term", name=op.f("dictionary_cache_pkey")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(length=50), nullable=False),
        sa.Column("level", sa.String(length=2), server_default="B1", nullable=False),
        sa.Column(
            "timezone", sa.String(length=64), server_default="Asia/Ho_Chi_Minh", nullable=False
        ),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "level IN ('A1','A2','B1','B2','C1','C2')", name=op.f("users_level_check")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("users_pkey")),
        sa.UniqueConstraint("email", name=op.f("users_email_key")),
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("icon", sa.String(length=40), server_default="folder", nullable=False),
        sa.Column("color", sa.String(length=9), server_default="#5B5BD6", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_pinned", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("categories_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("categories_pkey")),
        sa.UniqueConstraint("user_id", "name", name=op.f("categories_user_id_name_key")),
    )
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.CHAR(length=64), nullable=False),
        sa.Column("family_id", sa.UUID(), nullable=False),
        sa.Column("device_name", sa.String(length=100), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("refresh_tokens_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("refresh_tokens_pkey")),
        sa.UniqueConstraint("token_hash", name=op.f("refresh_tokens_token_hash_key")),
    )
    op.create_index("ix_refresh_tokens_family", "refresh_tokens", ["family_id"], unique=False)
    op.create_index("ix_refresh_tokens_user", "refresh_tokens", ["user_id"], unique=False)
    op.create_table(
        "word_lists",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("category_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=10), server_default="manual", nullable=False),
        sa.Column("ai_topic", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source IN ('manual','ai','import')", name=op.f("word_lists_source_check")
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name=op.f("word_lists_category_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("word_lists_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("word_lists_pkey")),
    )
    op.create_index("ix_word_lists_user", "word_lists", ["user_id"], unique=False)
    op.create_table(
        "words",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("list_id", sa.UUID(), nullable=False),
        sa.Column("term", sa.String(length=100), nullable=False),
        sa.Column("part_of_speech", sa.String(length=20), nullable=True),
        sa.Column("ipa", sa.String(length=100), nullable=True),
        sa.Column("meaning_vi", sa.Text(), nullable=False),
        sa.Column(
            "synonyms", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False
        ),
        sa.Column(
            "examples",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("audio_url", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("is_starred", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["list_id"], ["word_lists.id"], name=op.f("words_list_id_fkey"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("words_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("words_pkey")),
    )
    op.create_index("ix_words_user", "words", ["user_id"], unique=False)
    # Index biểu thức: viết tay theo DDL ở PLAN.md 7.2 (autogenerate không so sánh được).
    op.execute("CREATE UNIQUE INDEX ux_words_list_term ON words (list_id, lower(term))")
    op.execute("CREATE INDEX ix_words_user_term_trgm ON words USING gin (lower(term) gin_trgm_ops)")
    op.create_table(
        "word_progress",
        sa.Column("word_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column(
            "ease_factor",
            sa.Numeric(precision=4, scale=2),
            server_default=sa.text("2.50"),
            nullable=False,
        ),
        sa.Column("interval_days", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("repetitions", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("lapses", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("correct_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("wrong_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("word_progress_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["word_id"], ["words.id"], name=op.f("word_progress_word_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("word_id", name=op.f("word_progress_pkey")),
    )
    op.create_index(
        "ix_word_progress_user_due", "word_progress", ["user_id", "due_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_word_progress_user_due", table_name="word_progress")
    op.drop_table("word_progress")
    op.execute("DROP INDEX IF EXISTS ix_words_user_term_trgm")
    op.execute("DROP INDEX IF EXISTS ux_words_list_term")
    op.drop_index("ix_words_user", table_name="words")
    op.drop_table("words")
    op.drop_index("ix_word_lists_user", table_name="word_lists")
    op.drop_table("word_lists")
    op.drop_index("ix_refresh_tokens_user", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_family", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_table("categories")
    op.drop_table("users")
    op.drop_table("dictionary_cache")
