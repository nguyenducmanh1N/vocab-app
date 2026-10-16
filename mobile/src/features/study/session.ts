/** Dựng payload POST /study/sessions (PLAN.md 8.3). Hàm thuần để test bằng jest. */
import type { StudyMode, StudySessionIn } from "@/api/types";

import type { AnswerRecord } from "./types";

export type SessionMeta = {
  clientSessionId: string;
  listId: string | null;
  mode: StudyMode;
  startedAt: string;
};

/** Chỉ gửi các answer từ vị trí `sentCount` trở đi (các câu trước đã lên server). */
export function buildSessionPayload(
  meta: SessionMeta,
  answers: readonly AnswerRecord[],
  sentCount: number,
  end: { finished: boolean; endedAt?: string | null },
): StudySessionIn {
  return {
    client_session_id: meta.clientSessionId,
    list_id: meta.listId,
    mode: meta.mode,
    started_at: meta.startedAt,
    finished: end.finished,
    ended_at: end.finished ? (end.endedAt ?? null) : null,
    answers: answers.slice(sentCount),
  };
}
