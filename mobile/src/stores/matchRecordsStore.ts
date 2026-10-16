import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Khoá kỷ lục: theo list và số cặp (list ít hơn 6 từ chơi ít cặp hơn, không so chung). */
export function matchRecordKey(listId: string, pairs: number): string {
  return `${listId}:${pairs}`;
}

type MatchRecordsState = {
  /** Thời gian nhanh nhất (ms) theo matchRecordKey. */
  best: Record<string, number>;
  /** Ghi thời gian một ván; trả kỷ lục trước đó (undefined nếu chưa có) và có phá kỷ lục không. */
  submit: (
    listId: string,
    pairs: number,
    ms: number,
  ) => { previous: number | undefined; isRecord: boolean };
};

/** Kỷ lục Ghép cặp theo list, lưu trên máy (PLAN.md 11, P5.4). */
export const useMatchRecordsStore = create<MatchRecordsState>()(
  persist(
    (set, get) => ({
      best: {},
      submit: (listId, pairs, ms) => {
        const key = matchRecordKey(listId, pairs);
        const previous = get().best[key];
        const isRecord = previous === undefined || ms < previous;
        if (isRecord) set((state) => ({ best: { ...state.best, [key]: ms } }));
        return { previous, isRecord };
      },
    }),
    {
      name: "vt.match_records",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ best: state.best }),
    },
  ),
);
