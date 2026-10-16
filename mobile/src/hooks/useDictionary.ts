import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { enrichTerms } from "@/api/ai";
import { lookupDictionary, suggestTerms } from "@/api/dictionary";
import type { DictionaryOut, EnrichOut } from "@/api/types";

import { useDebounced } from "./useLibrary";

type AutofillHandlers = {
  onAi: (result: EnrichOut) => void;
  onAiError: (error: unknown) => void;
  onDictionary: (result: DictionaryOut) => void;
};

/**
 * Nút Tự điền: gọi song song AI và từ điển (PLAN.md P2.4). Bên nào xong trước thì điền trước,
 * không chờ bên chậm hơn; từ điển lỗi thì bỏ qua (backend đã trả found=false).
 * `pending` là true khi phần AI (phần chính) còn đang chạy.
 */
export function useAutofill() {
  const [pending, setPending] = useState(false);

  const run = async (term: string, handlers: AutofillHandlers): Promise<void> => {
    setPending(true);
    const dictionary = lookupDictionary(term)
      .then(handlers.onDictionary)
      .catch(() => undefined);
    try {
      handlers.onAi(await enrichTerms([term]));
    } catch (err) {
      handlers.onAiError(err);
    } finally {
      setPending(false);
    }
    await dictionary;
  };

  return { run, pending };
}

/** Gợi ý khi gõ ở ô Từ; chờ 250 ms sau khi ngừng gõ, cần ít nhất 2 ký tự. */
export function useTermSuggestions(q: string, enabled: boolean) {
  const term = useDebounced(q.trim().toLowerCase(), 250);
  return useQuery({
    queryKey: ["term-suggest", term],
    queryFn: ({ signal }) => suggestTerms(term, signal),
    enabled: enabled && term.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous, // giữ gợi ý cũ trong lúc chờ, tránh nhấp nháy
  });
}

export type TermCheck = {
  dictionary: DictionaryOut | null; // null nếu gọi lỗi (mạng…)
  alternatives: string[]; // từ gần đúng khi từ điển không có từ này
};

/**
 * Tra từ điển ngay khi người dùng gõ xong ô Từ (miễn phí, không tốn lượt AI).
 * Không thấy thì lấy thêm vài từ gần đúng để gợi ý sửa chính tả.
 */
export function useTermCheck() {
  const [pending, setPending] = useState(false);

  const check = async (term: string): Promise<TermCheck> => {
    setPending(true);
    try {
      const dictionary = await lookupDictionary(term).catch(() => null);
      if (dictionary?.found) return { dictionary, alternatives: [] };
      const key = term.trim().toLowerCase();
      const alternatives = (await suggestTerms(key).catch(() => []))
        .map((s) => s.term)
        .filter((t) => t !== key)
        .slice(0, 4);
      return { dictionary, alternatives };
    } finally {
      setPending(false);
    }
  };

  return { check, pending };
}
