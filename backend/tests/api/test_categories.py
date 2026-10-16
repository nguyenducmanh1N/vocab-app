import uuid
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import WordList

URL = "/api/v1/categories"


async def create(client: AsyncClient, auth: dict[str, Any], **body: Any) -> Response:
    return await client.post(URL, json=body, headers=auth["headers"])


async def created(client: AsyncClient, auth: dict[str, Any], **body: Any) -> dict[str, Any]:
    response = await create(client, auth, **body)
    assert response.status_code == 201, response.text
    return response.json()


async def add_lists(engine: AsyncEngine, user_id: str, category_id: str | None, n: int) -> None:
    """P1.5 chưa có API list nên thêm thẳng vào DB."""
    async with AsyncSession(engine) as session:
        for i in range(n):
            session.add(WordList(user_id=user_id, category_id=category_id, name=f"List {i}"))
        await session.commit()


# --- CRUD ------------------------------------------------------------------------------------


async def test_create_with_defaults(client: AsyncClient, auth: dict[str, Any]):
    response = await create(client, auth, name="  Du lịch  ")

    assert response.status_code == 201
    body = response.json()
    uuid.UUID(body["id"])
    assert body == {
        "id": body["id"],
        "name": "Du lịch",
        "icon": "folder",
        "color": "#5B5BD6",
        "sort_order": 0,
        "is_pinned": False,
        "list_count": 0,
    }


async def test_list_includes_list_count(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
):
    travel = await created(client, auth, name="Du lịch", icon="airplane", color="#16A34A")
    work = await created(client, auth, name="Công việc")
    await add_lists(test_engine, auth["user"]["id"], travel["id"], 3)
    await add_lists(test_engine, auth["user"]["id"], None, 2)  # "Chưa phân loại"

    response = await client.get(URL, headers=auth["headers"])

    assert response.status_code == 200
    counts = {c["name"]: c["list_count"] for c in response.json()}
    assert counts == {"Du lịch": 3, "Công việc": 0}
    assert work["list_count"] == 0


async def test_update_fields(client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine):
    category = await created(client, auth, name="Du lịch")
    await add_lists(test_engine, auth["user"]["id"], category["id"], 2)

    response = await client.patch(
        f"{URL}/{category['id']}",
        json={
            "name": "Đi chơi",
            "icon": "map",
            "color": "#DC2626",
            "sort_order": 5,
            "is_pinned": True,
        },
        headers=auth["headers"],
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["icon"], body["color"]) == ("Đi chơi", "map", "#DC2626")
    assert (body["sort_order"], body["is_pinned"], body["list_count"]) == (5, True, 2)


async def test_update_keeping_same_name_is_ok(client: AsyncClient, auth: dict[str, Any]):
    category = await created(client, auth, name="Du lịch")

    response = await client.patch(
        f"{URL}/{category['id']}",
        json={"name": "Du lịch", "is_pinned": True},
        headers=auth["headers"],
    )

    assert response.status_code == 200


async def test_delete_moves_lists_to_uncategorized(
    client: AsyncClient, auth: dict[str, Any], test_engine: AsyncEngine
):
    category = await created(client, auth, name="Du lịch")
    await add_lists(test_engine, auth["user"]["id"], category["id"], 2)

    response = await client.delete(f"{URL}/{category['id']}", headers=auth["headers"])

    assert response.status_code == 204
    assert (await client.get(URL, headers=auth["headers"])).json() == []
    async with AsyncSession(test_engine) as session:
        category_ids = (await session.scalars(select(WordList.category_id))).all()
    assert category_ids == [None, None]


async def test_unknown_category_is_404(client: AsyncClient, auth: dict[str, Any]):
    missing = uuid.uuid4()

    patch = await client.patch(f"{URL}/{missing}", json={"name": "X"}, headers=auth["headers"])
    delete = await client.delete(f"{URL}/{missing}", headers=auth["headers"])

    assert patch.status_code == delete.status_code == 404
    assert patch.json()["error"]["code"] == "NOT_FOUND"


# --- Trùng tên -------------------------------------------------------------------------------


async def test_create_duplicate_name_is_409(client: AsyncClient, auth: dict[str, Any]):
    await created(client, auth, name="Du lịch")

    response = await create(client, auth, name=" Du lịch ")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_NAME"


async def test_rename_to_existing_name_is_409(client: AsyncClient, auth: dict[str, Any]):
    await created(client, auth, name="Du lịch")
    work = await created(client, auth, name="Công việc")

    response = await client.patch(
        f"{URL}/{work['id']}", json={"name": "Du lịch"}, headers=auth["headers"]
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_NAME"


async def test_same_name_allowed_for_different_users(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
):
    await created(client, auth, name="Du lịch")

    assert (await create(client, other_auth, name="Du lịch")).status_code == 201


# --- Thứ tự ----------------------------------------------------------------------------------


async def test_order_pinned_then_sort_order_then_name(client: AsyncClient, auth: dict[str, Any]):
    for name, sort_order, pinned in [
        ("Cuộc sống", 0, False),
        ("Ẩm thực", 2, True),
        ("Bóng đá", 1, False),
        ("An toàn", 1, False),
        ("Zoo", 0, True),
        ("Âm nhạc", 0, False),
    ]:
        category = await created(client, auth, name=name)
        response = await client.patch(
            f"{URL}/{category['id']}",
            json={"sort_order": sort_order, "is_pinned": pinned},
            headers=auth["headers"],
        )
        assert response.status_code == 200

    names = [c["name"] for c in (await client.get(URL, headers=auth["headers"])).json()]

    # Ghim: Zoo (0), Ẩm thực (2). Chưa ghim: sort_order 0 (Âm nhạc, Cuộc sống), rồi 1 (An toàn,
    # Bóng đá). Thứ tự "Âm"/"Cuộc" phụ thuộc collation nên chỉ so tập hợp.
    assert names[:2] == ["Zoo", "Ẩm thực"]
    assert set(names[2:4]) == {"Âm nhạc", "Cuộc sống"}
    assert names[4:] == ["An toàn", "Bóng đá"]


# --- Validate --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": "x" * 61},
        {"name": "A", "color": "red"},
        {"name": "A", "icon": "Bad Icon"},
        {"name": "A", "khoa_la": 1},
    ],
)
async def test_create_validation_error(client: AsyncClient, auth: dict[str, Any], body: dict):
    response = await client.post(URL, json=body, headers=auth["headers"])

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("body", [{"name": None}, {"sort_order": -1}, {"is_pinned": None}])
async def test_update_validation_error(client: AsyncClient, auth: dict[str, Any], body: dict):
    category = await created(client, auth, name="Du lịch")

    response = await client.patch(f"{URL}/{category['id']}", json=body, headers=auth["headers"])

    assert response.status_code == 422


async def test_requires_token(client: AsyncClient):
    assert (await client.get(URL)).status_code == 401


# --- Quyền sở hữu ----------------------------------------------------------------------------


async def test_other_user_cannot_read_update_or_delete(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any]
):
    category = await created(client, auth, name="Du lịch")
    url = f"{URL}/{category['id']}"

    listed = await client.get(URL, headers=other_auth["headers"])
    patch = await client.patch(url, json={"name": "Của B"}, headers=other_auth["headers"])
    delete = await client.delete(url, headers=other_auth["headers"])

    assert listed.json() == []
    assert patch.status_code == 404
    assert delete.status_code == 404
    assert patch.json()["error"]["code"] == delete.json()["error"]["code"] == "NOT_FOUND"

    # Danh mục của A còn nguyên
    mine = (await client.get(URL, headers=auth["headers"])).json()
    assert [c["name"] for c in mine] == ["Du lịch"]


async def test_list_count_ignores_other_users_lists(
    client: AsyncClient, auth: dict[str, Any], other_auth: dict[str, Any], test_engine: AsyncEngine
):
    category = await created(client, auth, name="Du lịch")
    # Dữ liệu sai lệch (list của B trỏ vào danh mục của A) cũng không được đếm
    await add_lists(test_engine, other_auth["user"]["id"], category["id"], 2)

    listed = (await client.get(URL, headers=auth["headers"])).json()

    assert listed[0]["list_count"] == 0
