import { api } from "./client";
import { toQuery } from "./query";
import type { StudyMode, StudyQueueOut, StudySessionIn, StudySessionOut } from "./types";

export type StudyQueueParams = {
  listId?: string | null;
  mode: StudyMode;
  limit?: number;
  starredOnly?: boolean;
  /** Ôn tập hôm nay: học thêm từ mới ngoài hạn mức mỗi ngày (0–20). */
  extraNew?: number;
};

/** Không có listId: Ôn tập hôm nay; có listId: học theo list (PLAN.md 9.3). */
export function getStudyQueue(params: StudyQueueParams, signal?: AbortSignal): Promise<StudyQueueOut> {
  const query = toQuery({
    list_id: params.listId,
    mode: params.mode,
    limit: params.limit,
    starred_only: params.starredOnly || undefined,
    extra_new: params.extraNew || undefined,
  });
  return api.get<StudyQueueOut>(`/study/queue${query}`, signal);
}

/** Idempotent: gửi lại cùng client_session_id / client_answer_id không ghi trùng (9.4). */
export function postStudySession(body: StudySessionIn): Promise<StudySessionOut> {
  return api.post<StudySessionOut>("/study/sessions", body);
}
