/**
 * Một phiên học theo câu hỏi: lấy thẻ, giữ StudyEngine, gửi kết quả (useSessionSubmit).
 */
import { useMemo, useState } from "react";

import type { StudyMode } from "@/api/types";
import { useSettingsStore } from "@/stores/settingsStore";

import { StudyEngine, type GradedEntry } from "./engine";
import { isCorrectQuality } from "./quality";
import type { RetrySource } from "./summary";
import type { Quality, Question } from "./types";
import { useSessionCards, useSessionSubmit } from "./useSessionSubmit";

export { BATCH_SIZE } from "./useSessionSubmit";

/** Bản chụp trạng thái engine để render (engine là object thay đổi bên trong, không dùng trực tiếp). */
type Snapshot = {
  question: Question | null;
  done: boolean;
  answered: number;
  remaining: number;
  /** 0..1 cho thanh tiến độ; learn tính theo số từ đã xong. */
  progressValue: number;
  learned: { done: number; total: number };
  /** Hoàn tác được câu vừa chấm: chỉ khi câu đó chưa được đưa vào hàng đợi gửi. */
  canUndo: boolean;
  /** cloze: số từ bị bỏ vì không có câu ví dụ chứa chính từ đó. */
  skipped: number;
  /** Khi hết câu: các câu đã chấm (câu hỏi, câu trả lời, answer), để chấm bài kiểm tra; trước đó null. */
  graded: readonly GradedEntry[] | null;
};

function snapshotOf(engine: StudyEngine, enqueued = 0): Snapshot {
  const { answered, remaining } = engine.progress;
  const learned = engine.learnProgress;
  const progressValue =
    engine.mode === "learn"
      ? learned.total && learned.done / learned.total
      : answered + remaining && answered / (answered + remaining);
  return {
    question: engine.current,
    done: engine.done,
    answered,
    remaining,
    progressValue,
    learned,
    canUndo: engine.canUndo && engine.answers.length > enqueued,
    skipped: engine.skippedWordIds.length,
    graded: engine.done ? [...engine.history] : null,
  };
}

const EMPTY: Snapshot = {
  question: null,
  done: false,
  answered: 0,
  remaining: 0,
  progressValue: 0,
  learned: { done: 0, total: 0 },
  canUndo: false,
  skipped: 0,
  graded: null,
};

/**
 * `source`: thẻ có sẵn (phiên "Ôn lại từ sai") thì dùng luôn, không gọi /study/queue.
 */
export function useStudySession(
  mode: StudyMode,
  listId: string | null,
  source: RetrySource | null = null,
  extraNew = 0,
) {
  const direction = useSettingsStore((s) => s.settings.card_direction);
  const queue = useSessionCards(mode, listId, source, extraNew);

  // Dữ liệu queue không refetch trong phiên nên engine chỉ tạo một lần.
  const engine = useMemo(
    () =>
      queue.data
        ? new StudyEngine({
            mode,
            cards: queue.data.cards,
            distractorPool: queue.data.distractor_pool,
            direction,
          })
        : null,
    // direction đổi giữa phiên không tạo phiên mới
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue.data, mode],
  );
  const submit = useSessionSubmit(mode, listId, engine, queue.data);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const view = snapshot ?? (engine ? snapshotOf(engine) : EMPTY);

  /**
   * Chấm ngay khi trả lời (response_ms đúng thời gian nghĩ) nhưng chưa chuyển câu:
   * câu vừa trả lời vẫn hiện để xem đáp án, tới khi gọi next().
   */
  const answer = (quality: Quality, isCorrect: boolean, given?: string) => {
    if (!engine) return;
    engine.submit({ quality, isCorrect, given });
    submit.afterAnswer();
  };

  /** Qua thẻ giới thiệu từ mới (review): không chấm, không gửi. */
  const skipIntro = () => {
    if (!engine) return;
    engine.skipIntro();
    setSnapshot(snapshotOf(engine, submit.enqueued()));
  };

  /** Thời gian nghĩ của câu đang hiện (cùng mốc với response_ms gửi lên server). */
  const elapsedMs = () => engine?.elapsedMs ?? 0;

  /** Sang câu tiếp theo (đọc lại trạng thái engine). */
  const next = () => {
    if (engine) setSnapshot(snapshotOf(engine, submit.enqueued()));
  };

  /** Hoàn tác câu vừa trả lời (vd. vuốt nhầm); câu đó hiện lại để trả lời lại. */
  const undo = () => {
    if (!engine || engine.answers.length <= submit.enqueued()) return;
    if (engine.undo()) setSnapshot(snapshotOf(engine, submit.enqueued()));
  };

  /** Flashcard: tự đánh giá rồi sang thẻ tiếp ngay. */
  const rate = (quality: Quality) => {
    answer(quality, isCorrectQuality(quality));
    next();
  };

  return {
    queue,
    direction,
    ...view,
    answer,
    next,
    rate,
    skipIntro,
    undo,
    finish: submit.finish,
    elapsedMs,
  };
}
