"""ai generations insight extract kind

Revision ID: 87620c4f784f
Revises: 204cb062ca56
Create Date: 2026-10-16 21:40:20.125957

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "87620c4f784f"
down_revision: str | Sequence[str] | None = "204cb062ca56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Thêm kind 'insight' (P7.3) và 'extract' (P8.1); Postgres không sửa CHECK tại chỗ được.
    op.drop_constraint(op.f("ai_generations_kind_check"), "ai_generations", type_="check")
    op.create_check_constraint(
        op.f("ai_generations_kind_check"),
        "ai_generations",
        "kind IN ('suggest','enrich','speaking','insight','extract')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM ai_generations WHERE kind IN ('insight','extract')")
    op.drop_constraint(op.f("ai_generations_kind_check"), "ai_generations", type_="check")
    op.create_check_constraint(
        op.f("ai_generations_kind_check"),
        "ai_generations",
        "kind IN ('suggest','enrich','speaking')",
    )
