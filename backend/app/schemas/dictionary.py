from pydantic import BaseModel


class DictionaryOut(BaseModel):
    term: str
    found: bool
    ipa: str | None = None
    audio_url: str | None = None
    part_of_speech: str | None = None
    definitions_en: list[str] = []
    # false khi từ điển đang lỗi/không trả lời: found=false lúc đó không có nghĩa là "không có từ"
    available: bool = True


class TermSuggestion(BaseModel):
    term: str
    already_saved: bool  # đã có trong thư viện của user (ở bất kỳ list nào)
