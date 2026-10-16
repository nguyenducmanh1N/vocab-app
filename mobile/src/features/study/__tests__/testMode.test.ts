import { describe, expect, it } from "@jest/globals";

import { StudyEngine } from "../engine";
import { CLOZE_BLANK, TEST_SIZE, isClozeEligible, isMcq } from "../generators";
import { seededRng } from "../random";
import { buildSessionPayload } from "../session";
import { summarize } from "../summary";
import { testResult } from "../testReview";
import type { Question, QuestionKind, StudyCard } from "../types";
import { counterIds, makeCard } from "../__fixtures__/cards";

/** Thẻ số chẵn có câu ví dụ chứa từ (đủ điều kiện cloze), thẻ số lẻ có câu không chứa từ. */
function cards(count: number): StudyCard[] {
  return Array.from({ length: count }, (_, i) => ({
    ...makeCard(`word${i}`, `nghĩa ${i}`),
    examples: [{ en: i % 2 === 0 ? `The word${i} is here.` : "Nothing to see.", vi: "" }],
  }));
}

function engineFor(list: StudyCard[], seed = 11) {
  return new StudyEngine({ mode: "test", cards: list, rng: seededRng(seed), newId: counterIds(), now: () => 0 });
}

const group = (kind: QuestionKind) => (isMcq(kind) ? "mcq" : kind);

/** Trả lời hết bài; `correctAt(i)` quyết định câu thứ i đúng hay sai. */
function runAll(engine: StudyEngine, correctAt: (index: number) => boolean = () => true): Question[] {
  const shown: Question[] = [];
  while (!engine.done) {
    const question = engine.current!;
    const correct = correctAt(shown.length);
    shown.push(question);
    engine.submit({
      quality: correct ? 4 : 1,
      isCorrect: correct,
      given: correct ? question.answer : `sai-${shown.length}`,
    });
  }
  return shown;
}

describe("test: sinh bài", () => {
  it("list đủ từ: đúng 20 câu, mỗi từ một câu, trộn trắc nghiệm / gõ từ / điền chỗ trống", () => {
    const engine = engineFor(cards(30));
    const shown = runAll(engine);
    expect(shown).toHaveLength(TEST_SIZE);
    expect(new Set(shown.map((q) => q.card.id)).size).toBe(TEST_SIZE);
    expect(new Set(shown.map((q) => group(q.kind)))).toEqual(new Set(["mcq", "type_word", "cloze"]));
    expect(engine.answers.every((a) => a.is_first_attempt)).toBe(true);
  });

  it("cloze chỉ dùng từ đủ điều kiện, và luôn có đúng một chỗ trống", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const question of runAll(engineFor(cards(7), seed)).filter((q) => q.kind === "cloze")) {
        expect(isClozeEligible(question.card)).toBe(true);
        expect(question.prompt.split(CLOZE_BLANK)).toHaveLength(2);
      }
    }
  });

  it("list ít từ: hỏi lại từ bằng loại khác; câu lặp của cùng từ gửi is_first_attempt = false", () => {
    // 4 từ: 2 đủ điều kiện cloze (3 loại), 2 không (2 loại) → 10 câu, chưa tới 20
    const engine = engineFor(cards(4));
    const shown = runAll(engine);
    expect(shown).toHaveLength(10);
    for (const card of cards(4)) {
      const own = shown.filter((q) => q.card.id === card.id).map((q) => group(q.kind));
      expect(new Set(own).size).toBe(own.length); // mỗi loại tối đa một câu
      expect(own).toHaveLength(isClozeEligible(card) ? 3 : 2);
    }
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i].card.id).not.toBe(shown[i - 1].card.id); // không hỏi cùng từ liền nhau
    }
    const seen = new Set<string>();
    for (const answer of engine.answers) {
      expect(answer.is_first_attempt).toBe(!seen.has(answer.word_id));
      seen.add(answer.word_id);
    }
  });

  it("câu sai không hỏi lại, không hoàn tác được", () => {
    const engine = engineFor(cards(5));
    const total = engine.progress.remaining;
    const shown = runAll(engine, (i) => i % 2 === 1);
    expect(shown).toHaveLength(total);
    expect(engine.canUndo).toBe(false);
    expect(engine.undo()).toBeNull();
  });
});

describe("test: chấm cuối bài", () => {
  it("điểm khớp số câu đúng trong log gửi lên server (và màn tổng kết)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const engine = engineFor(cards(25), seed);
      const rng = seededRng(seed * 31);
      runAll(engine, () => rng() < 0.6);

      const result = testResult(engine.history);
      const payload = buildSessionPayload(
        { clientSessionId: "s", listId: "l", mode: "test", startedAt: "2026-10-16T00:00:00Z" },
        engine.answers,
        0,
        { finished: true, endedAt: "2026-10-16T00:05:00Z" },
      );
      const loggedCorrect = payload.answers.filter((a) => a.is_correct).length;
      expect(result.correct).toBe(loggedCorrect);
      expect(result.total).toBe(payload.answers.length);
      expect(result.wrong).toHaveLength(payload.answers.length - loggedCorrect);
      const summary = summarize({
        mode: "test",
        listId: "l",
        startedAt: payload.started_at,
        endedAt: payload.ended_at!,
        answers: engine.answers,
        cards: [],
        distractorPool: [],
        wrongWordIds: engine.wrongWordIds,
      });
      expect(summary.correct).toBe(result.correct);
    }
  });

  it("danh sách câu sai kèm câu trả lời và đáp án, theo thứ tự làm bài", () => {
    const engine = engineFor(cards(6));
    const shown = runAll(engine, (i) => i !== 1 && i !== 4);
    const { wrong, correct, total, percent } = testResult(engine.history);
    expect([correct, total]).toEqual([shown.length - 2, shown.length]);
    expect(percent).toBe(Math.round(((shown.length - 2) / shown.length) * 100));
    expect(wrong.map((item) => item.card.id)).toEqual([shown[1].card.id, shown[4].card.id]);
    expect(wrong[0]).toMatchObject({ given: "sai-2", answer: shown[1].answer });
    for (const [item, question] of [
      [wrong[0], shown[1]],
      [wrong[1], shown[4]],
    ] as const) {
      if (question.kind === "cloze") expect(item.sentence).toBe(question.prompt);
      if (question.kind === "mcq_en_vi") expect(item.ask).toBe(`Nghĩa của “${question.card.term}”`);
    }
  });

  it("bài trống: 0 điểm, không chia cho 0", () => {
    expect(testResult([])).toEqual({ correct: 0, total: 0, percent: 0, wrong: [] });
  });
});
