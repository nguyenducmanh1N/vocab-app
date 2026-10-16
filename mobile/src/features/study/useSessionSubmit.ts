/**
 * Lấy thẻ (/study/queue) và gửi kết quả (/study/sessions) cho một phiên học, dùng chung cho mọi chế độ.
 * Kết quả đi qua hàng đợi offline: một lô sau mỗi 10 câu và lô cuối (finished) khi kết thúc.
 */
import { useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useMemo, useRef } from "react";

import { getStudyQueue } from "@/api/study";
import type { StudyMode, StudyQueueOut, StudySessionOut } from "@/api/types";
import { useAuthStore } from "@/stores/authStore";

import { buildSessionPayload, type SessionMeta } from "./session";
import type { RetrySource, SessionRecord } from "./summary";
import { studyQueue } from "./studyQueue";
import type { AnswerRecord } from "./types";

export const BATCH_SIZE = 10; // gửi một lô sau mỗi 10 câu trả lời (10.3)

/** Nơi giữ các câu trả lời của phiên (StudyEngine, MatchGame). */
export type AnswerSource = {
  readonly answers: readonly AnswerRecord[];
  readonly wrongWordIds: readonly string[];
};

/**
 * Thẻ của phiên. `source`: thẻ có sẵn (phiên "Ôn lại từ sai") thì dùng luôn, không gọi /study/queue.
 */
export function useSessionCards(
  mode: StudyMode,
  listId: string | null,
  source: RetrySource | null = null,
  extraNew = 0,
) {
  return useQuery<StudyQueueOut>({
    // Key riêng (không phải 'study-queue'): làm mới study-queue sau mỗi lô gửi không được
    // tải lại thẻ và tạo lại engine giữa phiên.
    queryKey: ["study-session", mode, listId, source ? "retry" : "queue", extraNew],
    queryFn: ({ signal }) =>
      source
        ? Promise.resolve({
            ...source,
            stats: { due_total: 0, new_available: 0 },
          })
        : getStudyQueue({ mode, listId, extraNew }, signal),
    staleTime: Infinity,
    gcTime: 0, // mỗi lần mở màn là một phiên mới
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * Gửi kết quả của `source`. `cards`: dữ liệu thẻ của phiên, để màn tổng kết và "Ôn lại từ sai".
 * Một `source` là một phiên (client_session_id tạo một lần theo source).
 */
export function useSessionSubmit(
  mode: StudyMode,
  listId: string | null,
  source: AnswerSource | null,
  cards: RetrySource | undefined,
) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const meta = useMemo<SessionMeta | null>(
    () =>
      source
        ? {
            clientSessionId: Crypto.randomUUID(),
            listId,
            mode,
            startedAt: new Date().toISOString(),
          }
        : null,
    [source, listId, mode],
  );
  const enqueuedRef = useRef(0); // số answer đã đưa vào hàng đợi (chỉ dùng trong callback)
  const finishedRef = useRef(false);

  /** Đưa các answer chưa vào hàng thành một lô; trả item đã ghi vào storage. */
  const enqueueRest = (finished: boolean, endedAt: string | null = null) => {
    if (!source || !meta || !userId) return null;
    const answers = source.answers;
    const payload = buildSessionPayload(meta, answers, enqueuedRef.current, { finished, endedAt });
    enqueuedRef.current = answers.length;
    return studyQueue.enqueue(userId, payload);
  };

  /** Gọi sau mỗi câu trả lời: đủ 10 câu chưa gửi thì gửi một lô. */
  const afterAnswer = () => {
    if (!source || !userId || source.answers.length - enqueuedRef.current < BATCH_SIZE) return;
    enqueueRest(false)
      ?.then(() => studyQueue.flush(userId))
      .catch(() => undefined); // còn trong hàng đợi: gửi lại sau
  };

  /** Số answer đã đưa vào hàng đợi gửi (không hoàn tác được nữa). */
  const enqueued = () => enqueuedRef.current;

  /**
   * Kết thúc phiên: ghi lô cuối (finished) vào hàng đợi rồi gửi.
   * Chờ hàm này xong là kết quả đã nằm an toàn trên máy; `result` chờ thêm phản hồi server
   * (null nếu đang mất mạng: hàng đợi gửi lại khi app vào foreground hoặc sau phiên sau).
   * `record` là dữ liệu phiên cho màn tổng kết; null nếu chưa trả lời câu nào.
   */
  const finish = async (): Promise<{
    result: Promise<StudySessionOut | null>;
    record: SessionRecord | null;
  }> => {
    const none = { result: Promise.resolve(null), record: null };
    if (!source || !meta || !userId || finishedRef.current || source.answers.length === 0) {
      return none;
    }
    finishedRef.current = true;
    const endedAt = new Date().toISOString();
    const item = await enqueueRest(true, endedAt);
    if (!item) return none;
    const result = studyQueue
      .flush(userId)
      .then(({ sent }) => sent.find((entry) => entry.id === item.id)?.result ?? null)
      .catch(() => null);
    const record: SessionRecord = {
      mode,
      listId,
      startedAt: meta.startedAt,
      endedAt,
      answers: [...source.answers],
      cards: cards?.cards ?? [],
      distractorPool: cards?.distractor_pool ?? [],
      wrongWordIds: [...source.wrongWordIds],
    };
    return { result, record };
  };

  return { afterAnswer, enqueued, finish };
}
