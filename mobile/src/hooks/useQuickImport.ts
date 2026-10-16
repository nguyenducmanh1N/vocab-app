import { useMutation, useQueryClient } from "@tanstack/react-query";

import { enrichTerms } from "@/api/ai";
import { lookupDictionary } from "@/api/dictionary";
import { bulkCreateWords } from "@/api/lists";
import type { DictionaryOut, SuggestedWord, WordCreate } from "@/api/types";

export const ENRICH_BATCH = 30; // /ai/enrich nhận tối đa 30 term (PLAN.md 9.8)
const BULK_BATCH = 100; // /lists/{id}/words/bulk nhận tối đa 100 từ

export type EnrichProgress = { done: number; total: number };

export type EnrichBatchesResult = {
  words: Map<string, SuggestedWord>; // khoá: term viết thường
  unknown: string[];
  error: unknown | null; // lỗi ở lô nào đó (vd. hết lượt); các lô trước vẫn giữ kết quả
  remaining: number | null;
};

/** Tự điền các dòng chưa có nghĩa theo lô 30 từ, lần lượt từng lô; mỗi lô tốn 1 lượt AI. */
export async function enrichInBatches(
  terms: string[],
  onProgress: (progress: EnrichProgress) => void,
): Promise<EnrichBatchesResult> {
  const words = new Map<string, SuggestedWord>();
  const unknown: string[] = [];
  let remaining: number | null = null;
  for (let i = 0; i < terms.length; i += ENRICH_BATCH) {
    const batch = terms.slice(i, i + ENRICH_BATCH);
    try {
      const result = await enrichTerms(batch);
      // Khoá theo từ người dùng gõ: từ AI sửa chính tả có corrected_from.
      for (const word of result.words) {
        words.set((word.corrected_from ?? word.term).toLowerCase(), word);
      }
      unknown.push(...result.unknown_terms);
      remaining = result.remaining_today;
    } catch (error) {
      return { words, unknown, error, remaining };
    }
    onProgress({ done: Math.min(i + ENRICH_BATCH, terms.length), total: terms.length });
  }
  return { words, unknown, error: null, remaining };
}

export type ImportResult = { created: number; skipped: string[] };

/** Lưu bằng bulk theo lô 100; trả số từ đã thêm và các từ bị bỏ qua vì đã có trong list. */
export function useImportWords(listId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (words: WordCreate[]): Promise<ImportResult> => {
      let created = 0;
      const skipped: string[] = [];
      for (let i = 0; i < words.length; i += BULK_BATCH) {
        const result = await bulkCreateWords(listId, words.slice(i, i + BULK_BATCH));
        created += result.created.length;
        skipped.push(...result.skipped.map((s) => s.term));
      }
      return { created, skipped };
    },
    onSettled: () =>
      Promise.all(
        ["lists", "list", "categories", "words", "word-search", "ai-quota"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
}

const DICTIONARY_CONCURRENCY = 5;

/**
 * Tra từ điển ngầm (miễn phí, không tốn lượt AI) cho các từ người dùng tự ghi nghĩa, để có IPA,
 * phát âm và định nghĩa tiếng Anh. Chỉ tra cụm tối đa 3 từ; lỗi thì bỏ qua.
 */
export async function lookupMany(
  terms: string[],
  onResult: (term: string, result: DictionaryOut) => void,
): Promise<void> {
  const queue = terms.filter((t) => t.split(/\s+/).length <= 3);
  const worker = async () => {
    for (let term = queue.shift(); term !== undefined; term = queue.shift()) {
      try {
        const result = await lookupDictionary(term);
        if (result.found) onResult(term, result);
      } catch {
        // bỏ qua: từ điển lỗi thì giữ nguyên dòng
      }
    }
  };
  await Promise.all(Array.from({ length: DICTIONARY_CONCURRENCY }, worker));
}
