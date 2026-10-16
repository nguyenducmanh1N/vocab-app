import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel

from app.core.errors import AppError


class Payload(BaseModel):
    n: int


@pytest.fixture(autouse=True)
def test_routes(app: FastAPI) -> None:
    @app.post("/_test/validate")
    async def validate(payload: Payload) -> dict[str, int]:
        return {"n": payload.n}

    @app.get("/_test/app-error")
    async def app_error() -> None:
        raise AppError(409, "DUPLICATE_NAME", "Tên đã tồn tại", {"name": "Travel"})


async def test_validation_error_format(client: AsyncClient) -> None:
    response = await client.post("/_test/validate", json={"n": "abc"})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert isinstance(error["message"], str)
    [detail] = error["details"]
    assert detail["field"] == "body.n"
    assert detail["type"] == "int_parsing"
    assert isinstance(detail["message"], str)


async def test_app_error_format(client: AsyncClient) -> None:
    response = await client.get("/_test/app-error")

    assert response.status_code == 409
    assert response.json() == {
        "error": {
            "code": "DUPLICATE_NAME",
            "message": "Tên đã tồn tại",
            "details": {"name": "Travel"},
        }
    }


async def test_not_found_format(client: AsyncClient) -> None:
    response = await client.get("/api/v1/khong-co")

    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "NOT_FOUND", "message": "Not Found", "details": None}
    }
