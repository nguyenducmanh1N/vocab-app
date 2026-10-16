/** Quy đổi điểm q (0–5) theo bảng ở PLAN.md 9.2; app tính, backend chỉ kiểm tra miền. */
import type { Quality } from "./types";

export const SLOW_MS = 10_000; // đúng nhưng quá 10 giây → q = 3

export type FlashcardRating = "forgot" | "hard" | "good" | "easy";
export type SpeakingRating = "not_yet" | "ok" | "good" | "great";

const RATING_QUALITY: Record<FlashcardRating, Quality> = { forgot: 1, hard: 3, good: 4, easy: 5 };
const SPEAKING_QUALITY: Record<SpeakingRating, Quality> = { not_yet: 1, ok: 3, good: 4, great: 5 };

/** Flashcard: Quên / Khó / Được / Dễ. */
export function flashcardQuality(rating: FlashcardRating): Quality {
  return RATING_QUALITY[rating];
}

/** Flashcard: vuốt trái (chưa nhớ) / vuốt phải (nhớ). */
export function swipeQuality(direction: "left" | "right"): Quality {
  return direction === "left" ? 1 : 4;
}

/** Luyện nói, tự chấm: Chưa được / Tạm / Tốt / Rất tốt. */
export function speakingQuality(rating: SpeakingRating): Quality {
  return SPEAKING_QUALITY[rating];
}

/** Câu có đúng sai (trắc nghiệm, gõ, điền chỗ trống…). */
export function answerQuality(input: {
  correct: boolean;
  responseMs: number;
  usedHint?: boolean;
  nearMissAccepted?: boolean; // "gần đúng" được tự chấm là đúng
}): Quality {
  if (!input.correct) return 1;
  if (input.responseMs > SLOW_MS || input.usedHint || input.nearMissAccepted) return 3;
  return 4;
}

/** is_correct cho các câu tự đánh giá (flashcard, luyện nói): từ "Khó"/"Tạm" trở lên là nhớ. */
export function isCorrectQuality(quality: Quality): boolean {
  return quality >= 3;
}
