import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { SuggestedWord, SuggestIn } from "@/api/types";

export type PreviewItem = SuggestedWord & { selected: boolean };

export type SuggestTarget = { id: string; name: string } | null; // null = list mới tên chủ đề

type SuggestState = {
  params: SuggestIn | null;
  items: PreviewItem[];
  target: SuggestTarget;
  /** Kết quả gợi ý mới (thay toàn bộ) — từ đã có trong thư viện mặc định không chọn. */
  start: (params: SuggestIn, words: SuggestedWord[], target?: SuggestTarget) => void;
  setTarget: (target: SuggestTarget) => void;
  /** "Gợi ý thêm": nối vào cuối, bỏ từ đã hiện. */
  append: (words: SuggestedWord[]) => void;
  toggle: (term: string) => void;
  setAll: (selected: boolean) => void;
  editMeaning: (term: string, meaning: string) => void;
  clear: () => void;
};

const toItem = (word: SuggestedWord): PreviewItem => ({ ...word, selected: !word.already_saved });

/**
 * Phiên gợi ý đang xem ở màn Xem trước (PLAN.md 10.1 ai/preview). Lưu nháp vào AsyncStorage:
 * thoát app giữa chừng thì lần sau vẫn tiếp tục duyệt được; lưu xong thì xoá.
 */
export const useSuggestStore = create<SuggestState>()(
  persist(
    (set) => ({
      params: null,
      items: [],
      target: null,
      start: (params, words, target = null) => set({ params, items: words.map(toItem), target }),
      setTarget: (target) => set({ target }),
      append: (words) =>
        set((state) => {
          const seen = new Set(state.items.map((i) => i.term));
          return {
            items: [...state.items, ...words.filter((w) => !seen.has(w.term)).map(toItem)],
          };
        }),
      toggle: (term) =>
        set((state) => ({
          items: state.items.map((i) => (i.term === term ? { ...i, selected: !i.selected } : i)),
        })),
      setAll: (selected) =>
        set((state) => ({ items: state.items.map((i) => ({ ...i, selected })) })),
      editMeaning: (term, meaning) =>
        set((state) => ({
          items: state.items.map((i) => (i.term === term ? { ...i, meaning_vi: meaning } : i)),
        })),
      clear: () => set({ params: null, items: [], target: null }),
    }),
    {
      name: "vt.draft.suggest",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ params: state.params, items: state.items, target: state.target }),
    },
  ),
);
