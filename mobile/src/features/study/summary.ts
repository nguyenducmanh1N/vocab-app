/** Tổng kết một phiên học (PLAN.md 10.3 bước 5). Hàm thuần để test bằng jest. */
import type { DistractorItem, StudyMode, StudySessionOut } from "@/api/types";

import type { AnswerRecord, StudyCard } from "./types";

export const MAX_STUDY_SECONDS = 2 * 60 * 60; // server cũng chỉ tính tối đa 2 giờ (9.4)

/** Dữ liệu một phiên vừa kết thúc, đủ để tổng kết và mở phiên "Ôn lại từ sai". */
export type SessionRecord = {
  mode: StudyMode;
  listId: string | null;
  startedAt: string;
  endedAt: string;
  answers: readonly AnswerRecord[];
  cards: readonly StudyCard[];
  distractorPool: readonly DistractorItem[];
  wrongWordIds: readonly string[];
};

export type SessionSummary = {
  total: number;
  correct: number;
  wrong: number;
  durationSec: number;
  wrongCards: StudyCard[];
};

/**
 * Đếm như server (9.4 bước 4): mọi câu trả lời, kể cả câu hỏi lại, đều vào total/correct.
 * Thời gian lấy đúng hai mốc started_at/ended_at đã gửi lên.
 */
export function summarize(record: SessionRecord): SessionSummary {
  const total = record.answers.length;
  const correct = record.answers.filter((a) => a.is_correct).length;
  const seconds = (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000;
  const byId = new Map(record.cards.map((card) => [card.id, card]));
  const wrongCards = [...new Set(record.wrongWordIds)]
    .map((id) => byId.get(id))
    .filter((card): card is StudyCard => card !== undefined);
  return {
    total,
    correct,
    wrong: total - correct,
    durationSec: Math.min(Math.max(0, Math.round(seconds)), MAX_STUDY_SECONDS),
    wrongCards,
  };
}

export type RetrySource = { cards: StudyCard[]; distractor_pool: DistractorItem[] };

/**
 * Phiên "Ôn lại từ sai": chỉ các thẻ sai; đáp án nhiễu lấy từ distractor_pool cũ cộng các thẻ
 * khác của phiên, để vẫn đủ 4 lựa chọn khi chỉ sai một từ. Không gọi lại API.
 */
export function retrySource(record: SessionRecord): RetrySource {
  const { wrongCards } = summarize(record);
  const wrongIds = new Set(wrongCards.map((card) => card.id));
  const pool = new Map<string, DistractorItem>();
  for (const item of record.distractorPool) pool.set(item.word_id, item);
  for (const card of record.cards) {
    pool.set(card.id, {
      word_id: card.id,
      term: card.term,
      meaning_vi: card.meaning_vi,
      part_of_speech: card.part_of_speech,
    });
  }
  for (const id of wrongIds) pool.delete(id);
  return { cards: wrongCards, distractor_pool: [...pool.values()] };
}

export function formatDuration(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes === 0) return `${seconds} giây`;
  return seconds ? `${minutes} phút ${seconds} giây` : `${minutes} phút`;
}

/** Kết quả server cho phiên vừa xong: undefined = đang gửi, null = chờ mạng (trong hàng đợi). */
export type PendingResult = StudySessionOut | null | undefined;
