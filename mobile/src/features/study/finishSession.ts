/** Kết thúc phiên và chuẩn bị màn tổng kết (dùng chung cho màn học và Ghép cặp). */
import type { StudySessionOut } from "@/api/types";
import { useRecentListsStore } from "@/stores/recentListsStore";
import { useStudySummaryStore } from "@/stores/studySummaryStore";

import type { SessionRecord } from "./summary";

type Finish = () => Promise<{
  result: Promise<StudySessionOut | null>;
  record: SessionRecord | null;
}>;

/**
 * Ghi lô cuối vào hàng đợi (nhanh, chạy cả khi mất mạng), đưa dữ liệu phiên vào store tổng kết.
 * Trả false nếu chưa trả lời câu nào (không có gì để tổng kết).
 */
export async function finishToSummary(finish: Finish): Promise<boolean> {
  const { result, record } = await finish();
  if (!record) return false;
  if (record.listId) useRecentListsStore.getState().touch(record.listId);
  const store = useStudySummaryStore.getState();
  store.setRecord(record);
  // Phản hồi server tới sau; bỏ qua nếu lúc đó đã sang phiên khác.
  result.then((out) => {
    if (useStudySummaryStore.getState().record === record) store.setResult(out);
  });
  return true;
}
