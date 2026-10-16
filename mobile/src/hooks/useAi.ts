import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  extractFromImage,
  getAiHistory,
  getAiHistoryDetail,
  getAiQuota,
  speakingFeedback,
  suggestWords,
} from "@/api/ai";
import { bulkCreateWords, createList } from "@/api/lists";
import type { SpeakingFeedbackIn, SuggestedWord, SuggestIn, WordCreate } from "@/api/types";
import { useAiConsent } from "@/features/ai/consent";

// Chưa đồng ý dùng AI thì không gọi: server trả 403 (PLAN.md 9.16).
export function useAiQuota() {
  const { granted } = useAiConsent();
  return useQuery({
    queryKey: ["ai-quota"],
    queryFn: ({ signal }) => getAiQuota(signal),
    enabled: granted,
  });
}

export function useAiHistory() {
  const { granted } = useAiConsent();
  return useQuery({
    queryKey: ["ai-history"],
    queryFn: ({ signal }) => getAiHistory(20, signal),
    enabled: granted,
  });
}

/** Gợi ý mới hoặc "Gợi ý thêm"; xong thì làm mới lịch sử và số lượt (PLAN.md 10.2). */
export function useSuggest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SuggestIn) => suggestWords(body),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["ai-history"] }),
        client.invalidateQueries({ queryKey: ["ai-quota"] }),
      ]),
  });
}

export function useOpenHistory() {
  return useMutation({ mutationFn: (id: string) => getAiHistoryDetail(id) });
}

export function toWordCreate(word: SuggestedWord): WordCreate {
  return {
    term: word.term,
    meaning_vi: word.meaning_vi.trim(),
    definition_en: word.definition_en ?? null,
    part_of_speech: word.part_of_speech,
    ipa: word.ipa,
    synonyms: word.synonyms.slice(0, 5),
    examples: word.examples.slice(0, 3),
    audio_url: word.audio_url,
  };
}

type SaveInput =
  | { target: "new"; topic: string; words: SuggestedWord[] }
  | { target: "existing"; listId: string; words: SuggestedWord[] };

const BULK_LIMIT = 100;

/** Tạo list mới (source = ai) nếu cần rồi thêm hàng loạt; trả listId và số từ đã lưu/bỏ qua. */
export function useSaveSuggestions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveInput) => {
      const listId =
        input.target === "existing"
          ? input.listId
          : (
              await createList({
                name: input.topic.slice(0, 100),
                source: "ai",
                ai_topic: input.topic.slice(0, 200),
              })
            ).id;
      let created = 0;
      let skipped = 0;
      for (let i = 0; i < input.words.length; i += BULK_LIMIT) {
        const batch = input.words.slice(i, i + BULK_LIMIT).map(toWordCreate);
        const result = await bulkCreateWords(listId, batch);
        created += result.created.length;
        skipped += result.skipped.length;
      }
      return { listId, created, skipped };
    },
    onSettled: () =>
      Promise.all(
        ["lists", "list", "categories", "words", "word-search", "ai-history"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
}

/** Lọc từ trong ảnh; xong thì làm mới lịch sử và số lượt. */
export function useExtract() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ base64, level }: { base64: string; level: string }) =>
      extractFromImage(base64, level),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["ai-history"] }),
        client.invalidateQueries({ queryKey: ["ai-quota"] }),
      ]),
  });
}

export function useSpeakingFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SpeakingFeedbackIn) => speakingFeedback(body),
    onSettled: () => client.invalidateQueries({ queryKey: ["ai-quota"] }),
  });
}
