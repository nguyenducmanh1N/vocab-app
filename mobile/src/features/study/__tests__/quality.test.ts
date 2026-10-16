import { describe, expect, it } from "@jest/globals";
import {
  type FlashcardRating,
  type SpeakingRating,
  answerQuality,
  flashcardQuality,
  isCorrectQuality,
  speakingQuality,
  swipeQuality,
} from "../quality";
import type { Quality } from "../types";

describe("quy đổi q theo bảng 9.2", () => {
  it.each<[FlashcardRating, Quality]>([
    ["forgot", 1],
    ["hard", 3],
    ["good", 4],
    ["easy", 5],
  ])("Flashcard %s → %d", (rating, q) => {
    expect(flashcardQuality(rating)).toBe(q);
  });

  it.each<["left" | "right", Quality]>([
    ["left", 1],
    ["right", 4],
  ])("Flashcard vuốt %s → %d", (direction, q) => {
    expect(swipeQuality(direction)).toBe(q);
  });

  it.each([
    ["sai", { correct: false, responseMs: 2000 }, 1],
    ["sai dù nhanh và không gợi ý", { correct: false, responseMs: 100 }, 1],
    ["đúng", { correct: true, responseMs: 2000 }, 4],
    ["đúng ở đúng mốc 10 giây", { correct: true, responseMs: 10_000 }, 4],
    ["đúng nhưng quá 10 giây", { correct: true, responseMs: 10_001 }, 3],
    ["đúng nhưng đã xem gợi ý", { correct: true, responseMs: 2000, usedHint: true }, 3],
    ["gần đúng tự chấm là đúng", { correct: true, responseMs: 2000, nearMissAccepted: true }, 3],
  ])("Câu có đúng sai: %s", (_label, input, q) => {
    expect(answerQuality(input)).toBe(q);
  });

  it.each<[SpeakingRating, Quality]>([
    ["not_yet", 1],
    ["ok", 3],
    ["good", 4],
    ["great", 5],
  ])("Luyện nói %s → %d", (rating, q) => {
    expect(speakingQuality(rating)).toBe(q);
  });

  it("is_correct của câu tự đánh giá: từ q = 3 trở lên", () => {
    expect([0, 1, 2, 3, 4, 5].map((q) => isCorrectQuality(q as Quality))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});
