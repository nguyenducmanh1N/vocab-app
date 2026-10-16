import { router } from "expo-router";
import { useState } from "react";
import { Alert, Share } from "react-native";

import { suggestWords } from "@/api/ai";
import { exportListCsv } from "@/api/lists";
import type { ListOut, SuggestIn, WordOut } from "@/api/types";
import { getWords, WORDS_PAGE_SIZE } from "@/api/words";
import { aiErrorMessage } from "@/features/ai/format";
import { useAuthStore } from "@/stores/authStore";
import { useSuggestStore } from "@/stores/suggestStore";

import { shareCsv } from "./csvShare";
import { pickOption, showError } from "./dialogs";

const MAX_EXCLUDE = 200; // giới hạn exclude_terms của /ai/suggest

/** Tải toàn bộ từ của list (theo trang 50 từ); `max` để dừng sớm. */
export async function fetchAllWords(listId: string, max = Infinity): Promise<WordOut[]> {
  const words: WordOut[] = [];
  for (let offset = 0; offset < max; offset += WORDS_PAGE_SIZE) {
    const page = await getWords(listId, {}, offset);
    words.push(...page.items);
    if (words.length >= page.total || !page.items.length) break;
  }
  return words.slice(0, max);
}

/** "term - nghĩa", mỗi dòng một từ: dán lại vào Nhập nhanh được. */
export function toQuickImportText(words: WordOut[]): string {
  return words.map((w) => `${w.term} - ${w.meaning_vi}`).join("\n");
}

export function useListExtras() {
  const userLevel = useAuthStore((s) => s.user?.level);
  const start = useSuggestStore((s) => s.start);
  const [busy, setBusy] = useState<null | "suggest" | "export">(null);

  /** Gợi ý thêm từ theo chủ đề của list, loại các từ đã có; lưu thẳng vào list này. */
  async function suggestForList(list: ListOut): Promise<void> {
    setBusy("suggest");
    try {
      const existing = await fetchAllWords(list.id, MAX_EXCLUDE);
      const params: SuggestIn = {
        topic: (list.ai_topic ?? list.name).slice(0, 100),
        level: userLevel ?? "B1",
        count: 20,
        word_types: ["word", "phrase"],
        exclude_terms: existing.map((w) => w.term.toLowerCase()),
      };
      const result = await suggestWords(params);
      start(params, result.words, { id: list.id, name: list.name });
      router.push("/ai/preview");
    } catch (err) {
      Alert.alert("Không gợi ý được", aiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  /** Xuất list: văn bản (dán lại vào Nhập nhanh được) hoặc file CSV mở bằng Excel/Numbers. */
  async function exportList(list: ListOut): Promise<void> {
    const choice = await pickOption("Xuất list", [
      "Chia sẻ dạng văn bản (term - nghĩa)",
      "Xuất file CSV",
    ]);
    if (choice === null) return;
    setBusy("export");
    try {
      if (choice === 0) {
        const words = await fetchAllWords(list.id);
        await Share.share({ title: list.name, message: toQuickImportText(words) });
      } else {
        await shareCsv(await exportListCsv(list.id), list.name); // CSV do server tạo (PLAN.md 8.3)
      }
    } catch (err) {
      showError(err, "Không xuất được list");
    } finally {
      setBusy(null);
    }
  }

  return { suggestForList, exportList, busy };
}
