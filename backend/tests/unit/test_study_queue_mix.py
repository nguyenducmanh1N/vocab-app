from app.services.study_service import interleave


def test_one_new_after_every_four_due() -> None:
    due = [f"d{i}" for i in range(1, 10)]
    assert interleave(due, ["n1", "n2", "n3"]) == [
        "d1", "d2", "d3", "d4", "n1", "d5", "d6", "d7", "d8", "n2", "d9", "n3",
    ]  # fmt: skip


def test_no_new_words() -> None:
    assert interleave(["d1", "d2"], []) == ["d1", "d2"]


def test_no_due_words_returns_new_in_order() -> None:
    assert interleave([], ["n1", "n2"]) == ["n1", "n2"]


def test_fewer_than_four_due_appends_new_at_end() -> None:
    assert interleave(["d1", "d2", "d3"], ["n1", "n2"]) == ["d1", "d2", "d3", "n1", "n2"]


def test_more_new_than_slots_appends_rest() -> None:
    assert interleave(["d1", "d2", "d3", "d4"], ["n1", "n2", "n3"]) == [
        "d1", "d2", "d3", "d4", "n1", "n2", "n3",
    ]  # fmt: skip
