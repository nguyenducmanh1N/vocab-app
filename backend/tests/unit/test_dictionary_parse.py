"""Parse response thật của Free Dictionary (tests/fixtures/dictionary_*.json) theo PLAN.md 9.6."""

import json
from pathlib import Path
from typing import Any

from app.services.dictionary_service import parse_entries

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def load(name: str) -> Any:
    return json.loads((FIXTURES / f"dictionary_{name}.json").read_text())


def test_prefers_us_audio_even_when_not_first() -> None:
    # phonetics: -au.mp3, -uk.mp3, -us.mp3
    out = parse_entries("ubiquitous", load("ubiquitous"))

    assert (
        out.audio_url == "https://api.dictionaryapi.dev/media/pronunciations/en/ubiquitous-us.mp3"
    )


def test_ipa_from_phonetics_when_entry_phonetic_missing() -> None:
    # entry không có "phonetic"; phonetics[0] không có text, phonetics[1] có
    out = parse_entries("ubiquitous", load("ubiquitous"))

    assert out.ipa == "/juːˈbɪk.wə.təs/"


def test_first_audio_when_no_us_audio() -> None:
    out = parse_entries("meticulous", load("meticulous"))

    assert (
        out.audio_url == "https://api.dictionaryapi.dev/media/pronunciations/en/meticulous-uk.mp3"
    )
    assert out.ipa == "/mɨˈtɪkjuləs/"  # bỏ qua phonetics không có text


def test_deadline_fields() -> None:
    out = parse_entries("deadline", load("deadline"))

    assert out.found is True
    assert out.ipa == "/ˈdɛdˌlaɪn/"  # entry.phonetic
    assert out.part_of_speech == "noun"
    assert out.definitions_en == [
        "A time limit in the form of a date on or before which something must be completed.",
        "A guideline marked on a plate for a printing press.",
        "A line that does not move.",
    ]


def test_no_audio_word() -> None:
    entries = load("no_audio")
    term = entries[0]["word"]

    out = parse_entries(term, entries)

    assert out.found is True
    assert out.audio_url is None
    assert out.definitions_en


def test_tolerates_missing_fields() -> None:
    out = parse_entries("x", [{"word": "x"}, {"phonetics": [{"audio": ""}], "meanings": []}])

    assert (out.ipa, out.audio_url, out.part_of_speech, out.definitions_en) == (
        None,
        None,
        None,
        [],
    )
