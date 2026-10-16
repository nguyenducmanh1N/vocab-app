import { create } from "zustand";

import type { PendingResult, RetrySource, SessionRecord } from "@/features/study/summary";

type StudySummaryState = {
  /** Phiên vừa kết thúc, màn study/summary đọc từ đây. */
  record: SessionRecord | null;
  result: PendingResult;
  /** Thẻ cho phiên "Ôn lại từ sai" (dùng lại dữ liệu, không gọi API). */
  retry: RetrySource | null;
  setRecord: (record: SessionRecord) => void;
  setResult: (result: PendingResult) => void;
  setRetry: (retry: RetrySource | null) => void;
};

/** Chỉ giữ trong bộ nhớ: kết quả đã nằm an toàn trong hàng đợi offline (vt.pending_sessions). */
export const useStudySummaryStore = create<StudySummaryState>()((set) => ({
  record: null,
  result: undefined,
  retry: null,
  setRecord: (record) => set({ record, result: undefined }),
  setResult: (result) => set({ result }),
  setRetry: (retry) => set({ retry }),
}));
