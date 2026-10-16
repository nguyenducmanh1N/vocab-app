"""users ai consent

Revision ID: 204cb062ca56
Revises: bb8592b127f8
Create Date: 2026-10-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "204cb062ca56"
down_revision: str | Sequence[str] | None = "bb8592b127f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ai_consent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("ai_consent_version", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "ai_consent_version")
    op.drop_column("users", "ai_consent_at")
