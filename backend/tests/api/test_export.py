"""Xuất CSV: GET /lists/{id}/export và GET /me/export (PLAN.md 8.3)."""

import csv
import io
import uuid
from datetime import timedelta
from typing import Any
from urllib.parse import unquote

from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import WordProgress
from app.services.export_service import COLUMNS
from tests.conftest import FakeClock

LISTS = "/api/v1/lists"


async def new_list(client: AsyncClient, auth: dict[str, Any], name: str) -> str:
    response = await client.post(LISTS, json={"name": name}, headers=auth["headers"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def add_word(client: AsyncClient, auth: dict[str, Any], list_id: str, **body: Any) -> str:
    response = await client.post(f"{LISTS}/{list_id}/words", json=body, headers=auth["headers"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


def parse(response: Response) -> list[dict[str, str]]:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "text/csv; charset=utf-8"
    assert response.content.startswith(b"\xef\xbb\xbf")  # BOM UTF-8
    text = response.content.decode("utf-8")
    assert "\r\n" in text  # CRLF theo RFC 4180
    reader = csv.DictReader(io.StringIO(text.removeprefix("﻿"), newline=""))
    assert reader.fieldnames == COLUMNS
    return list(reader)


async def test_list_export_has_every_column_and_vietnamese(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine, clock: FakeClock
) -> None:
    list_id = await new_list(client, auth, "Sân bay, ga tàu")
    word_id = await add_word(
        client,
        auth,
        list_id,
        term="boarding pass",
        meaning_vi="thẻ lên máy bay; vé lên tàu",
        definition_en='a card, marked "BOARDING"',
        part_of_speech="phrase",
        ipa="/ˈbɔːrdɪŋ pæs/",
        synonyms=["boarding card", "pass"],
        examples=[
            {"en": "Show it,\nplease.", "vi": "Xuất trình nhé."},
            {"en": "Lost my pass.", "vi": "Mất thẻ rồi."},
        ],
        note="quầy check-in",
        is_starred=True,
    )
    await add_word(client, auth, list_id, term="gate", meaning_vi="cổng")
    async with AsyncSession(test_engine) as session:
        progress = await session.get(WordProgress, uuid.UUID(word_id))
        progress.interval_days, progress.correct_count, progress.wrong_count = 25, 7, 2
        progress.due_at = clock.current + timedelta(days=25)
        await session.commit()

    rows = parse(await client.get(f"{LISTS}/{list_id}/export", headers=auth["headers"]))

    assert [row["term"] for row in rows] == ["boarding pass", "gate"]  # theo created_at
    first = rows[0]
    assert first["list_name"] == "Sân bay, ga tàu"
    assert first["meaning_vi"] == "thẻ lên máy bay; vé lên tàu"
    assert first["definition_en"] == 'a card, marked "BOARDING"'
    assert first["ipa"] == "/ˈbɔːrdɪŋ pæs/"
    assert first["synonyms"] == "boarding card; pass"
    assert (first["example_1_en"], first["example_1_vi"]) == (
        "Show it,\nplease.",
        "Xuất trình nhé.",
    )
    assert (first["example_2_en"], first["example_3_en"], first["example_3_vi"]) == (
        "Lost my pass.",
        "",
        "",
    )
    assert (first["note"], first["is_starred"], first["level"]) == (
        "quầy check-in",
        "true",
        "mastered",
    )
    assert (first["correct_count"], first["wrong_count"]) == ("7", "2")
    assert first["created_at"].endswith("+00:00")
    second = rows[1]
    assert (second["is_starred"], second["level"], second["part_of_speech"]) == ("false", "new", "")


async def test_formula_like_cells_are_neutralised(
    client: AsyncClient, auth: dict[str, Any]
) -> None:
    list_id = await new_list(client, auth, '=HYPERLINK("x")')
    await add_word(
        client, auth, list_id, term="+plus", meaning_vi="=1+1", note="@cmd", synonyms=["-1"]
    )

    [row] = parse(await client.get(f"{LISTS}/{list_id}/export", headers=auth["headers"]))

    assert row["list_name"] == '\'=HYPERLINK("x")'
    assert (row["term"], row["meaning_vi"], row["note"], row["synonyms"]) == (
        "'+plus",
        "'=1+1",
        "'@cmd",
        "'-1",
    )


async def test_content_disposition_keeps_vietnamese_name(
    client: AsyncClient, auth: dict[str, Any], clock: FakeClock
) -> None:
    list_id = await new_list(client, auth, "Từ vựng du lịch")

    response = await client.get(f"{LISTS}/{list_id}/export", headers=auth["headers"])

    disposition = response.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="vocabtopic-tu-vung-du-lich-')
    assert unquote(disposition.split("filename*=UTF-8''")[1]).startswith(
        "vocabtopic-Từ vựng du lịch-"
    )
    assert disposition.split('"')[1].endswith(".csv")
    assert parse(response) == []  # list rỗng: chỉ có dòng tiêu đề


async def test_export_all_groups_by_list_and_only_own_words(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    beta = await new_list(client, auth, "beta")
    alpha = await new_list(client, auth, "Alpha")
    await add_word(client, auth, beta, term="b1", meaning_vi="b")
    await add_word(client, auth, alpha, term="a1", meaning_vi="a")
    await add_word(client, auth, alpha, term="a2", meaning_vi="a")
    theirs = await new_list(client, other_auth, "Của Bình")
    await add_word(client, other_auth, theirs, term="secret", meaning_vi="bí mật")

    rows = parse(await client.get("/api/v1/me/export", headers=auth["headers"]))

    assert [(row["list_name"], row["term"]) for row in rows] == [
        ("Alpha", "a1"),
        ("Alpha", "a2"),
        ("beta", "b1"),
    ]


async def test_export_other_users_list_is_404_and_requires_token(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
) -> None:
    list_id = await new_list(client, auth, "Của An")

    theirs = await client.get(f"{LISTS}/{list_id}/export", headers=other_auth["headers"])
    missing = await client.get(f"{LISTS}/{uuid.uuid4()}/export", headers=auth["headers"])
    anonymous = [
        await client.get(f"{LISTS}/{list_id}/export"),
        await client.get("/api/v1/me/export"),
    ]

    assert (theirs.status_code, missing.status_code) == (404, 404)
    assert theirs.json()["error"]["code"] == "NOT_FOUND"
    assert [r.status_code for r in anonymous] == [401, 401]
