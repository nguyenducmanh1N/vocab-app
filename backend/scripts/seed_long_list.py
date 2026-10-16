"""Tạo list mẫu nhiều từ để thử cuộn danh sách dài trên app (P6.6). Chỉ dùng cho DB dev.

    cd backend && uv run python scripts/seed_long_list.py --email you@example.com
    cd backend && uv run python scripts/seed_long_list.py --email you@example.com --remove

Từ có độ dài nghĩa khác nhau, đủ 4 mức thuộc, một phần gắn sao và có ví dụ, để giống dữ liệu thật.
Chạy lại khi list mẫu đã có thì bỏ qua (thêm --remove để xoá trước).
"""

import argparse
import asyncio
import random
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.core.time import now_utc  # noqa: E402
from app.models import User, Word, WordList, WordProgress  # noqa: E402

LIST_NAME = "Mẫu 2.000 từ (thử cuộn)"
BASES = [
    ("abandon", "từ bỏ; bỏ rơi", "/əˈbændən/", "verb"),
    ("benefit", "lợi ích", "/ˈbenɪfɪt/", "noun"),
    ("curious", "tò mò", "/ˈkjʊriəs/", "adjective"),
    ("deadline", "hạn chót; thời hạn cuối cùng phải hoàn thành công việc", "/ˈdedlaɪn/", "noun"),
    ("efficient", "hiệu quả; làm việc nhanh mà không lãng phí", "/ɪˈfɪʃnt/", "adjective"),
    ("figure out", "tìm ra; hiểu ra", "/ˈfɪɡjər aʊt/", "phrase"),
    ("generous", "hào phóng", "/ˈdʒenərəs/", "adjective"),
    ("hesitate", "do dự; ngập ngừng", "/ˈhezɪteɪt/", "verb"),
    ("itinerary", "lịch trình chuyến đi", "/aɪˈtɪnəreri/", "noun"),
    ("break the ice", "phá vỡ sự ngượng ngùng ban đầu khi mới gặp nhau", None, "idiom"),
    ("luggage", "hành lý", "/ˈlʌɡɪdʒ/", "noun"),
    ("meticulous", "tỉ mỉ; cẩn thận đến từng chi tiết nhỏ", "/məˈtɪkjələs/", "adjective"),
]


def make_words(user_id, list_id, count: int, rng: random.Random) -> list[tuple[Word, dict]]:
    start = now_utc() - timedelta(days=60)
    rows = []
    for i in range(count):
        term, meaning, ipa, pos = BASES[i % len(BASES)]
        examples = (
            [{"en": f"This sentence uses {term} number {i + 1}.", "vi": f"Câu này dùng {term}."}]
            if i % 3 == 0
            else []
        )
        word = Word(
            user_id=user_id,
            list_id=list_id,
            term=f"{term} {i + 1:04d}",
            meaning_vi=meaning if i % 5 else f"{meaning}; nghĩa phụ số {i + 1} dài hơn bình thường",
            ipa=ipa,
            part_of_speech=pos,
            synonyms=["synonym"] if i % 4 == 0 else [],
            examples=examples,
            is_starred=i % 17 == 0,
            created_at=start + timedelta(seconds=i),
        )
        level = rng.choices(["new", "learning", "familiar", "mastered"], [4, 3, 2, 1])[0]
        interval = {"new": 0, "learning": rng.randint(1, 6), "familiar": rng.randint(7, 20)}.get(
            level, rng.randint(21, 90)
        )
        progress = {
            "interval_days": interval,
            "repetitions": 0 if level == "new" else rng.randint(1, 6),
            "due_at": None if level == "new" else now_utc() + timedelta(days=rng.randint(-3, 30)),
            "correct_count": rng.randint(0, 12) if level != "new" else 0,
            "wrong_count": rng.randint(0, 4) if level != "new" else 0,
        }
        rows.append((word, progress))
    return rows


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--email", required=True)
    parser.add_argument("--count", type=int, default=2000)
    parser.add_argument("--remove", action="store_true", help="xoá list mẫu rồi thoát")
    args = parser.parse_args()

    settings = get_settings()
    if settings.env != "development":
        raise SystemExit("Chỉ chạy trên môi trường development.")
    engine = create_async_engine(settings.database_url)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            user = await session.scalar(select(User).where(User.email == args.email.lower()))
            if user is None:
                raise SystemExit(f"Không có user {args.email}")
            existing = await session.scalar(
                select(WordList).where(WordList.user_id == user.id, WordList.name == LIST_NAME)
            )
            if args.remove:
                await session.execute(
                    delete(WordList).where(WordList.user_id == user.id, WordList.name == LIST_NAME)
                )
                await session.commit()
                print("Đã xoá list mẫu." if existing else "Không có list mẫu để xoá.")
                return
            if existing is not None:
                print(f"List mẫu đã có: {existing.id} (chạy với --remove để tạo lại)")
                return

            word_list = WordList(user_id=user.id, name=LIST_NAME, description="Dữ liệu thử P6.6")
            session.add(word_list)
            await session.flush()
            rows = make_words(user.id, word_list.id, args.count, random.Random(6))
            session.add_all(word for word, _ in rows)
            await session.flush()
            session.add_all(
                WordProgress(word_id=word.id, user_id=user.id, **progress)
                for word, progress in rows
            )
            await session.commit()
            total = await session.scalar(
                select(func.count()).select_from(Word).where(Word.list_id == word_list.id)
            )
            print(f"Đã tạo list {word_list.id} với {total} từ.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
