"""words insights and leech

Revision ID: bb8592b127f8
Revises: a90b8ecc42c4
Create Date: 2026-10-16 15:04:43.285411

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "bb8592b127f8"
down_revision: str | Sequence[str] | None = "a90b8ecc42c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON_LIST_COLUMNS = ("word_family", "collocations", "confusables")


def upgrade() -> None:
    op.add_column("words", sa.Column("mnemonic", sa.Text(), nullable=True))
    for name in JSON_LIST_COLUMNS:
        op.add_column(
            "words",
            sa.Column(
                name,
                postgresql.JSONB(astext_type=sa.Text()),
                server_default=sa.text("'[]'::jsonb"),
                nullable=False,
            ),
        )
    op.add_column(
        "word_progress",
        sa.Column("is_leech", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("word_progress", "is_leech")
    for name in reversed(JSON_LIST_COLUMNS):
        op.drop_column("words", name)
    op.drop_column("words", "mnemonic")
