"""Kiểm tra migration tạo đúng constraint của DDL 7.2 (unique lower(term), CHECK, ON DELETE)."""

import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.models import Category, User, Word, WordList, WordProgress


@pytest.fixture
async def session(test_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(test_engine, expire_on_commit=False) as s:
        yield s


async def make_user(session: AsyncSession, email: str = "a@example.com") -> User:
    user = User(email=email, password_hash="x", display_name="A")
    session.add(user)
    await session.flush()
    return user


async def make_list(session: AsyncSession, user: User, **kwargs: object) -> WordList:
    word_list = WordList(user_id=user.id, name=f"List {uuid.uuid4().hex[:6]}", **kwargs)
    session.add(word_list)
    await session.flush()
    return word_list


async def test_server_defaults(session: AsyncSession) -> None:
    user = await make_user(session)
    word_list = await make_list(session, user)
    word = Word(user_id=user.id, list_id=word_list.id, term="apple", meaning_vi="quả táo")
    session.add(word)
    await session.flush()
    session.add(WordProgress(word_id=word.id, user_id=user.id))
    await session.commit()

    await session.refresh(user)
    await session.refresh(word)
    progress = await session.get(WordProgress, word.id)
    assert user.level == "B1"
    assert user.timezone == "Asia/Ho_Chi_Minh"
    assert user.settings == {}
    assert word_list.source == "manual"
    assert word.synonyms == []
    assert word.examples == []
    assert word.is_starred is False
    assert word.created_at.tzinfo is not None
    assert progress is not None
    assert str(progress.ease_factor) == "2.50"
    assert progress.due_at is None


async def test_term_unique_per_list_case_insensitive(session: AsyncSession) -> None:
    user = await make_user(session)
    first, second = await make_list(session, user), await make_list(session, user)
    session.add(Word(user_id=user.id, list_id=first.id, term="Apple", meaning_vi="táo"))
    session.add(Word(user_id=user.id, list_id=second.id, term="apple", meaning_vi="táo"))
    await session.commit()

    session.add(Word(user_id=user.id, list_id=first.id, term="APPLE", meaning_vi="táo"))
    with pytest.raises(IntegrityError, match="ux_words_list_term"):
        await session.commit()


async def test_level_check(session: AsyncSession) -> None:
    session.add(User(email="b@example.com", password_hash="x", display_name="B", level="Z9"))
    with pytest.raises(IntegrityError, match="users_level_check"):
        await session.commit()


async def test_source_check(session: AsyncSession) -> None:
    user = await make_user(session)
    await session.commit()
    session.add(WordList(user_id=user.id, name="L", source="web"))
    with pytest.raises(IntegrityError, match="word_lists_source_check"):
        await session.commit()


async def test_category_name_unique_per_user(session: AsyncSession) -> None:
    user = await make_user(session)
    session.add(Category(user_id=user.id, name="Du lịch"))
    await session.commit()
    session.add(Category(user_id=user.id, name="Du lịch"))
    with pytest.raises(IntegrityError, match="categories_user_id_name_key"):
        await session.commit()


async def test_on_delete_rules(session: AsyncSession) -> None:
    user = await make_user(session)
    category = Category(user_id=user.id, name="Công việc")
    session.add(category)
    await session.flush()
    word_list = await make_list(session, user, category_id=category.id)
    word = Word(user_id=user.id, list_id=word_list.id, term="deadline", meaning_vi="hạn chót")
    session.add(word)
    await session.flush()
    session.add(WordProgress(word_id=word.id, user_id=user.id))
    await session.commit()

    # Xoá danh mục: list còn, category_id thành NULL
    await session.delete(category)
    await session.commit()
    await session.refresh(word_list)
    assert word_list.category_id is None

    # Xoá user: list, từ và tiến độ bị xoá theo
    await session.delete(user)
    await session.commit()
    for model in (WordList, Word, WordProgress):
        assert await session.scalar(select(func.count()).select_from(model)) == 0


async def test_clean_db_truncates_between_tests(session: AsyncSession) -> None:
    # Các test trên đều tạo user; clean_db phải xoá sạch trước test này.
    assert await session.scalar(select(func.count()).select_from(User)) == 0
