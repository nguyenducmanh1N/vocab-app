import { api } from "./client";
import { toQuery } from "./query";
import type { DictionaryOut, TermSuggestion } from "./types";

/** Tra Free Dictionary qua backend (có cache); từ điển lỗi thì backend trả found=false. */
export function lookupDictionary(term: string): Promise<DictionaryOut> {
  return api.get<DictionaryOut>(`/dictionary/${encodeURIComponent(term.trim())}`);
}

/** Gợi ý khi gõ ở ô Từ: từ đã lưu trước, rồi từ tiếng Anh. */
export function suggestTerms(q: string, signal?: AbortSignal): Promise<TermSuggestion[]> {
  return api.get<TermSuggestion[]>(`/dictionary/suggest${toQuery({ q, limit: 6 })}`, signal);
}
