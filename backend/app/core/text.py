import re
import unicodedata
from difflib import SequenceMatcher


def collapse_spaces(value: str) -> str:
    """Bỏ khoảng trắng đầu cuối và gộp khoảng trắng liên tiếp: "  take   off " -> "take off"."""
    return " ".join(value.split())


def normalize_term(term: str) -> str:
    """Khoá so trùng của từ; khớp với index ux_words_list_term (lower(term))."""
    return collapse_spaces(term).lower()


def escape_like(value: str) -> str:
    """Escape ký tự đặc biệt của LIKE; dùng kèm ESCAPE '\\'."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def topic_key(topic: str) -> str:
    """Khoá cache cho chủ đề gợi ý: bỏ dấu tiếng Việt, viết thường, gộp khoảng trắng (9.7).

    "Phỏng vấn  Đi làm" -> "phong van di lam". "đ" không tách dấu khi NFD nên đổi riêng.
    """
    decomposed = unicodedata.normalize("NFD", topic)
    stripped = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    stripped = stripped.replace("đ", "d").replace("Đ", "D")
    return collapse_spaces(stripped).lower()


def edit_distance(a: str, b: str) -> int:
    """Khoảng cách Levenshtein; dùng để nhận ra từ AI đã sửa chính tả ("recieve" → "receive")."""
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def looks_like_correction(original: str, corrected: str) -> bool:
    """Hai chuỗi đủ gần để coi là sửa chính tả: lệch tối đa 1/3 độ dài (ít nhất 2 ký tự)."""
    limit = max(2, len(original) // 3)
    return original != corrected and edit_distance(original, corrected) <= limit


def english_words(text: str) -> list[str]:
    """Các từ tiếng Anh viết thường, bỏ dấu câu: "Don't stop!" -> ["don't", "stop"]."""
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower().replace("’", "'"))


def sentence_similarity(heard: str, reference: str) -> float:
    """Độ giống 0..1 theo dãy từ (difflib), để biết người học có đọc câu mẫu không (9.11)."""
    a, b = english_words(heard), english_words(reference)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b, autojunk=False).ratio()
