/** Đáp án nhiễu cho câu trắc nghiệm (PLAN.md 10.3). */
import { normalize } from "./grading";
import { shuffle, type Rng } from "./random";
import type { Candidate, StudyCard } from "./types";

export const OPTION_COUNT = 4;

/**
 * Dự phòng khi cả kho của user chưa đủ 4 từ khác nhau (vừa bắt đầu dùng app):
 * vẫn luôn có đủ 4 lựa chọn. Chỉ dùng sau khi đã hết từ của user.
 */
export const FALLBACK: readonly Candidate[] = [
  ["time", "thời gian", "noun"],
  ["water", "nước", "noun"],
  ["house", "ngôi nhà", "noun"],
  ["friend", "bạn bè", "noun"],
  ["morning", "buổi sáng", "noun"],
  ["travel", "đi du lịch", "verb"],
  ["remember", "nhớ", "verb"],
  ["borrow", "mượn", "verb"],
  ["happy", "vui vẻ", "adjective"],
  ["expensive", "đắt", "adjective"],
  ["quickly", "nhanh chóng", "adverb"],
  ["always", "luôn luôn", "adverb"],
].map(([term, meaning_vi, part_of_speech]) => ({
  word_id: `fallback:${term}`,
  term,
  meaning_vi,
  part_of_speech,
}));

export function toCandidate(card: StudyCard): Candidate {
  return {
    word_id: card.id,
    term: card.term,
    meaning_vi: card.meaning_vi,
    part_of_speech: card.part_of_speech,
  };
}

/**
 * 4 lựa chọn (đáp án đúng + 3 từ khác) cho `field` của thẻ, đã xáo trộn.
 * Ưu tiên cùng loại từ; không có hai lựa chọn trùng chữ hiển thị (so sau normalize).
 */
export function pickOptions(
  card: Candidate,
  candidates: readonly Candidate[],
  field: "term" | "meaning_vi",
  rng: Rng,
): string[] {
  const correct = card[field];
  const others = candidates.filter((c) => c.word_id !== card.word_id);
  const samePos = card.part_of_speech
    ? others.filter((c) => c.part_of_speech === card.part_of_speech)
    : [];
  const restPos = others.filter((c) => !samePos.includes(c));

  const seen = new Set([normalize(correct)]);
  const picked: string[] = [];
  for (const candidate of [
    ...shuffle(samePos, rng),
    ...shuffle(restPos, rng),
    ...shuffle(FALLBACK, rng),
  ]) {
    if (picked.length === OPTION_COUNT - 1) break;
    const text = candidate[field];
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push(text);
  }
  return shuffle([correct, ...picked], rng);
}
