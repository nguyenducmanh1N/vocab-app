from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.schemas.user import UserOut


def _normalize_email(value: str) -> str:
    return value.strip().lower()


# Kiểm tra định dạng tối thiểu; email luôn lưu chữ thường.
Email = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
    AfterValidator(_normalize_email),
]


class RegisterIn(BaseModel):
    email: Email
    password: str = Field(min_length=8, max_length=128)
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)
    ]


class LoginIn(BaseModel):
    email: Email
    password: str = Field(min_length=1, max_length=128)
    device_name: str | None = Field(default=None, max_length=100)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=200)


class LogoutIn(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=200)


class ForgotPasswordIn(BaseModel):
    email: Email


class ResetPasswordIn(BaseModel):
    email: Email
    code: str = Field(pattern=r"^[0-9]{6}$")  # \d của pydantic khớp cả chữ số Unicode
    new_password: str = Field(min_length=8, max_length=128)
    device_name: str | None = Field(default=None, max_length=100)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int  # giây


class AuthOut(BaseModel):
    user: UserOut
    tokens: TokenPair
