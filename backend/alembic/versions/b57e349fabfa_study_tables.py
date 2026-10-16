"""study tables

Revision ID: b57e349fabfa
Revises: ae0a1598c716
Create Date: 2026-10-15 13:58:36.287906

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b57e349fabfa"
down_revision: str | Sequence[str] | None = "ae0a1598c716"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "daily_activity",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("activity_date", sa.Date(), nullable=False),
        sa.Column("cards_done", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("new_words", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("correct", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("study_seconds", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("goal_met", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("daily_activity_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "activity_date", name=op.f("daily_activity_pkey")),
    )
    op.create_table(
        "study_sessions",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("client_session_id", sa.UUID(), nullable=False),
        sa.Column("list_id", sa.UUID(), nullable=True),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("correct", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.ForeignKeyConstraint(
            ["list_id"],
            ["word_lists.id"],
            name=op.f("study_sessions_list_id_fkey"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("study_sessions_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("study_sessions_pkey")),
        sa.UniqueConstraint("client_session_id", name=op.f("study_sessions_client_session_id_key")),
    )
    op.create_index(
        "ix_study_sessions_user", "study_sessions", ["user_id", "started_at"], unique=False
    )
    op.create_table(
        "review_logs",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("word_id", sa.UUID(), nullable=False),
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("client_answer_id", sa.UUID(), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("quality", sa.SmallInteger(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("is_first_attempt", sa.Boolean(), nullable=False),
        sa.Column("counted_for_srs", sa.Boolean(), nullable=False),
        sa.Column("response_ms", sa.Integer(), nullable=True),
        sa.Column("interval_before", sa.Integer(), nullable=True),
        sa.Column("interval_after", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("quality BETWEEN 0 AND 5", name=op.f("review_logs_quality_check")),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["study_sessions.id"],
            name=op.f("review_logs_session_id_fkey"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("review_logs_user_id_fkey"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["word_id"], ["words.id"], name=op.f("review_logs_word_id_fkey"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("review_logs_pkey")),
        sa.UniqueConstraint("client_answer_id", name=op.f("review_logs_client_answer_id_key")),
    )
    op.create_index(
        "ix_review_logs_session_word", "review_logs", ["session_id", "word_id"], unique=False
    )
    op.create_index(
        "ix_review_logs_user_time", "review_logs", ["user_id", "reviewed_at"], unique=False
    )
    op.create_index("ix_review_logs_word", "review_logs", ["word_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_review_logs_word", table_name="review_logs")
    op.drop_index("ix_review_logs_user_time", table_name="review_logs")
    op.drop_index("ix_review_logs_session_word", table_name="review_logs")
    op.drop_table("review_logs")
    op.drop_index("ix_study_sessions_user", table_name="study_sessions")
    op.drop_table("study_sessions")
    op.drop_table("daily_activity")
