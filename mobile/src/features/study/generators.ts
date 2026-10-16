/** Sinh câu hỏi cho từng mode (PLAN.md 10.3). */
import { makeCloze, type Cloze } from "@/utils/cloze";

import { pickOptions, toCandidate } from "./distractors";
import { shuffle, type Rng } from "./random";
import type {
  Candidate,
  CardDirection,
  McqKind,
  Question,
  QuestionKind,
  StudyCard,
  StudyMode,
} from "./types";

export type GeneratorContext = {
  candidates: readonly Candidate[]; // cards + distractor_pool
  direction: CardDirection;
  rng: Rng;
  questionId: () => string; // id lượt hỏi phía client (không gửi lên server)
};

const MCQ_KINDS: readonly McqKind[] = ["mcq_en_vi", "mcq_vi_en", "mcq_audio"];

export function randomMcqKind(rng: Rng): McqKind {
  return MCQ_KINDS[Math.floor(rng() * MCQ_KINDS.length)];
}

export function isMcq(kind: QuestionKind): kind is McqKind {
  return (MCQ_KINDS as readonly string[]).includes(kind);
}

/** Mặt trước là từ (en_vi) hoặc nghĩa (vi_en); mặt sau là phần còn lại. */
export function flip(card: StudyCard, ctx: GeneratorContext, intro = false): Question {
  const enFirst = ctx.direction === "en_vi";
  return {
    id: ctx.questionId(),
    kind: "flip",
    card,
    prompt: enFirst ? card.term : card.meaning_vi,
    answer: enFirst ? card.meaning_vi : card.term,
    ...(intro ? { intro: true as const } : {}),
  };
}

/**
 * mcq_en_vi: hỏi từ, chọn nghĩa. mcq_vi_en: hỏi nghĩa, chọn từ.
 * mcq_audio: app phát âm `prompt` (không hiện chữ), chọn từ viết đúng.
 */
export function mcq(card: StudyCard, kind: McqKind, ctx: GeneratorContext): Question {
  const field = kind === "mcq_en_vi" ? "meaning_vi" : "term";
  return {
    id: ctx.questionId(),
    kind,
    card,
    prompt: kind === "mcq_vi_en" ? card.meaning_vi : card.term,
    options: pickOptions(toCandidate(card), ctx.candidates, field, ctx.rng),
    answer: card[field],
  };
}

/** Hiện nghĩa và loại từ, gõ từ tiếng Anh; gợi ý là chữ cái đầu. */
export function typeWord(card: StudyCard, ctx: GeneratorContext): Question {
  const pos = card.part_of_speech ? ` (${card.part_of_speech})` : "";
  return {
    id: ctx.questionId(),
    kind: "type_word",
    card,
    prompt: `${card.meaning_vi}${pos}`,
    answer: card.term,
    hint: card.term.charAt(0),
  };
}

export const CLOZE_BLANK = "____";

export type ClozeForm = "choose" | "type";

type ClozeExample = { cloze: Cloze; translation: string };

/** Các câu ví dụ có chứa chính từ đó (không phân biệt hoa thường), đã tách chỗ trống. */
function clozeExamples(card: StudyCard): ClozeExample[] {
  return card.examples.flatMap((example) => {
    const cloze = example.en.includes(CLOZE_BLANK) ? null : makeCloze(example.en, card.term);
    return cloze ? [{ cloze, translation: example.vi }] : [];
  });
}

/** Từ dùng được cho Điền chỗ trống: có ít nhất một câu ví dụ chứa chính từ đó. */
export function isClozeEligible(card: StudyCard): boolean {
  return clozeExamples(card).length > 0;
}

/**
 * Điền chỗ trống: câu ví dụ chứa từ, từ được che bằng `____`.
 * choose: chọn 1 trong 4 từ (answer = term). type: gõ chữ bị che (answer = đúng dạng trong câu).
 * Trả null nếu từ không có câu ví dụ phù hợp.
 */
export function cloze(card: StudyCard, form: ClozeForm, ctx: GeneratorContext): Question | null {
  const examples = clozeExamples(card);
  if (!examples.length) return null;
  const { cloze: parts, translation } = examples[Math.floor(ctx.rng() * examples.length)];
  return {
    id: ctx.questionId(),
    kind: "cloze",
    card,
    prompt: `${parts.before}${CLOZE_BLANK}${parts.after}`,
    answer: form === "choose" ? card.term : parts.answer,
    ...(form === "choose"
      ? { options: pickOptions(toCandidate(card), ctx.candidates, "term", ctx.rng) }
      : {}),
    ...(translation ? { translation } : {}),
  };
}

/** Câu cloze gõ hay chọn (dạng chọn có `options`). */
export function clozeForm(question: Question): ClozeForm {
  return question.options ? "choose" : "type";
}

/**
 * Bỏ các từ không có câu ví dụ chứa chính từ đó; các từ còn lại xen kẽ dạng chọn và dạng gõ.
 */
function clozeSession(cards: readonly StudyCard[], ctx: GeneratorContext): Question[] {
  const questions: Question[] = [];
  for (const card of cards) {
    const question = cloze(card, questions.length % 2 === 0 ? "choose" : "type", ctx);
    if (question) questions.push(question);
  }
  return questions;
}

export const TEST_SIZE = 20;

type TestKind = "mcq" | "type_word" | "cloze";

/** Một câu kiểm tra cho từ theo loại; cloze dạng chọn hoặc gõ ngẫu nhiên. */
function testQuestion(card: StudyCard, kind: TestKind, ctx: GeneratorContext): Question | null {
  if (kind === "mcq") return mcq(card, randomMcqKind(ctx.rng), ctx);
  if (kind === "type_word") return typeWord(card, ctx);
  return cloze(card, ctx.rng() < 0.5 ? "choose" : "type", ctx);
}

/**
 * Kiểm tra: tối đa 20 câu trộn trắc nghiệm, gõ từ, điền chỗ trống (cloze chỉ cho từ đủ điều kiện).
 * Vòng 1 mỗi từ một câu; list ít từ thì vòng sau hỏi lại từ đó bằng loại khác (mỗi từ mỗi loại
 * tối đa một câu), lần lượt theo từ để hai câu cùng từ không đứng liền nhau.
 */
function testSession(cards: readonly StudyCard[], ctx: GeneratorContext): Question[] {
  const plans = cards.map((card) => {
    const kinds: TestKind[] = ["mcq", "type_word", ...(isClozeEligible(card) ? ["cloze" as const] : [])];
    return { card, kinds: shuffle(kinds, ctx.rng) };
  });
  const questions: Question[] = [];
  for (let round = 0; questions.length < TEST_SIZE; round++) {
    const batch = plans.filter((plan) => round < plan.kinds.length);
    if (!batch.length) break;
    for (const plan of batch) {
      if (questions.length >= TEST_SIZE) break;
      const question = testQuestion(plan.card, plan.kinds[round], ctx);
      if (question) questions.push(question);
    }
  }
  return questions;
}

/** Câu hỏi lại cho câu sai: cùng loại (cloze giữ dạng chọn/gõ); mcq được tạo lại lựa chọn. */
export function retryQuestion(question: Question, ctx: GeneratorContext): Question {
  const { card, kind } = question;
  if (kind === "flip") return flip(card, ctx);
  if (kind === "type_word") return typeWord(card, ctx);
  if (kind === "dictation") return dictation(card, ctx);
  if (kind === "speak") return speaking(card, ctx);
  if (kind === "cloze") return cloze(card, clozeForm(question), ctx) ?? question;
  if (isMcq(kind)) return mcq(card, kind, ctx);
  throw new Error(`Chưa hỗ trợ loại câu hỏi ${kind}`);
}

/** Câu hỏi chấm điểm của review theo mức thuộc: từ mới hỏi mcq_en_vi. */
function reviewQuestion(card: StudyCard, ctx: GeneratorContext): Question {
  switch (card.progress.level) {
    case "new":
      return mcq(card, "mcq_en_vi", ctx);
    case "learning":
      return mcq(card, randomMcqKind(ctx.rng), ctx);
    default: // familiar, mastered
      return typeWord(card, ctx);
  }
}

/**
 * Review: giới thiệu hết các từ mới trước (thẻ flip, không chấm), rồi mới tới phần trả lời
 * theo thứ tự server trả về.
 */
function reviewSession(cards: readonly StudyCard[], ctx: GeneratorContext): Question[] {
  const fresh = cards.filter((card) => card.progress.level === "new");
  const intros = fresh.map((card, index) => ({
    ...flip(card, ctx, true),
    introPosition: { index: index + 1, total: fresh.length },
  }));
  return [...intros, ...cards.map((card) => reviewQuestion(card, ctx))];
}

/** Nghe chép: app phát âm `prompt` (không hiện chữ trước khi trả lời), gõ lại từ. */
export function dictation(card: StudyCard, ctx: GeneratorContext): Question {
  return { id: ctx.questionId(), kind: "dictation", card, prompt: card.term, answer: card.term };
}

/**
 * Luyện nói: một câu ví dụ của từ, ưu tiên câu chứa chính từ đó.
 * Từ chưa có câu ví dụ thì luyện nói chính từ (prompt = term).
 */
export function speaking(card: StudyCard, ctx: GeneratorContext): Question {
  const examples = card.examples.filter((example) => example.en.trim());
  const withTerm = examples.filter((example) => makeCloze(example.en, card.term));
  const pool = withTerm.length ? withTerm : examples;
  const example = pool.length ? pool[Math.floor(ctx.rng() * pool.length)] : null;
  return {
    id: ctx.questionId(),
    kind: "speak",
    card,
    prompt: example ? example.en.trim() : card.term,
    answer: card.term,
    ...(example?.vi ? { translation: example.vi } : {}),
  };
}

/** Hàng câu hỏi ban đầu, theo thứ tự thẻ server trả về. */
export function initialQuestions(
  mode: StudyMode,
  cards: readonly StudyCard[],
  ctx: GeneratorContext,
): Question[] {
  switch (mode) {
    case "flashcard":
      return cards.map((card) => flip(card, ctx));
    case "mcq":
    case "learn":
      return cards.map((card) => mcq(card, randomMcqKind(ctx.rng), ctx));
    case "typing":
      return cards.map((card) => typeWord(card, ctx));
    case "review":
      return reviewSession(cards, ctx);
    case "dictation":
      return cards.map((card) => dictation(card, ctx));
    case "cloze":
      return clozeSession(cards, ctx);
    case "test":
      return testSession(cards, ctx);
    case "speaking":
      return cards.map((card) => speaking(card, ctx));
    default:
      throw new Error(`Chưa hỗ trợ chế độ ${mode}`);
  }
}
