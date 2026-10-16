"""ai generations speaking kind

Revision ID: a90b8ecc42c4
Revises: 0ee3c36c27e4
Create Date: 2026-10-16 10:52:13.863511

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a90b8ecc42c4"
down_revision: str | Sequence[str] | None = "0ee3c36c27e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Thêm kind 'speaking' (nhận xét luyện nói, P6.3); Postgres không sửa CHECK tại chỗ được.
    op.drop_constraint(op.f("ai_generations_kind_check"), "ai_generations", type_="check")
    op.create_check_constraint(
        op.f("ai_generations_kind_check"),
        "ai_generations",
        "kind IN ('suggest','enrich','speaking')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM ai_generations WHERE kind = 'speaking'")
    op.drop_constraint(op.f("ai_generations_kind_check"), "ai_generations", type_="check")
    op.create_check_constraint(
        op.f("ai_generations_kind_check"), "ai_generations", "kind IN ('suggest','enrich')"
    )
