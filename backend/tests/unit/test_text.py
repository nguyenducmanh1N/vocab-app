from app.core.text import collapse_spaces, escape_like, normalize_term


def test_normalize_term() -> None:
    assert collapse_spaces("  take   off ") == "take off"
    assert normalize_term("  Take   OFF ") == "take off"


def test_escape_like() -> None:
    assert escape_like("50%_off\\") == "50\\%\\_off\\\\"


def test_suggest_topic_key() -> None:
    from app.core.text import topic_key

    assert topic_key("Phỏng vấn  Đi làm") == "phong van di lam"
    assert topic_key("  ĐẶT PHÒNG khách sạn ") == "dat phong khach san"
    assert topic_key("Coffee shop") == "coffee shop"


def test_looks_like_correction() -> None:
    from app.core.text import edit_distance, looks_like_correction

    assert edit_distance("recieve", "receive") == 2
    assert looks_like_correction("recieve", "receive")
    assert looks_like_correction("bussiness", "business")
    assert looks_like_correction("acomodation", "accommodation")
    assert not looks_like_correction("xyzzyq", "elephant")
    assert not looks_like_correction("deadline", "deadline")


def test_sentence_similarity() -> None:
    from app.core.text import english_words, sentence_similarity

    reference = "The barista made my coffee to go."
    assert english_words("Don’t STOP, ok?") == ["don't", "stop", "ok"]
    assert sentence_similarity("the barista made my coffee to go", reference) == 1.0
    # Thu thật ngày 16/10/2026: đọc sai nhiều chỗ nhưng vẫn là câu mẫu
    assert sentence_similarity("They be ready to make my coffee to go.", reference) >= 0.4
    assert sentence_similarity("They buried a mate my coffee to go", reference) >= 0.4
    assert sentence_similarity("I would like to book a table for two tonight.", reference) < 0.4
    assert sentence_similarity("", reference) == 0.0
