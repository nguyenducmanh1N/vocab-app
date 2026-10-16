"""words definition_en

Revision ID: ae0a1598c716
Revises: b227e48c09fa
Create Date: 2026-10-15 11:59:07.355651

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ae0a1598c716"
down_revision: str | Sequence[str] | None = "b227e48c09fa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("words", sa.Column("definition_en", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("words", "definition_en")
