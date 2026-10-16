import { describe, expect, it } from "@jest/globals";
import { StudyEngine, type EngineOptions } from "../engine";
import { isMcq } from "../generators";
import { seededRng } from "../random";
import type { AnswerRecord, CardDirection, Question, QuestionKind } from "../types";
import { counterIds, makeCard } from "../__fixtures__/cards";

type Step = { question: Question; record: AnswerRecord | null };

function engineFor(options: Partial<EngineOptions> & Pick<EngineOptions, "mode" | "cards">) {
  return new StudyEngine({ rng: seededRng(7), newId: counterIds(), now: () => 0, ...options });
}

/** Chạy hết phiên; `isCorrect(question, step)` quyết định đúng/sai từng câu. */
function runAll(
  engine: StudyEngine,
  isCorrect: (question: Question, index: number) => boolean = () => true,
): Step[] {
  const steps: Step[] = [];
  for (let guard = 0; !engine.done; guard++) {
    if (guard > 500) throw new Error("Phiên không kết thúc");
    const question = engine.current!;
    if (question.intro) {
      engine.skipIntro();
      steps.push({ question, record: null });
      continue;
    }
    const correct = isCorrect(question, steps.length);
    const record = engine.submit({ quality: correct ? 4 : 1, isCorrect: correct });
    steps.push({ question, record });
  }
  return steps;
}

const kindGroup = (kind: QuestionKind) => (isMcq(kind) ? "mcq" : kind);

const WORDS = [
  makeCard("deadline", "hạn chót"),
  makeCard("meeting", "cuộc họp"),
  makeCard("budget", "ngân sách"),
  makeCard("report", "báo cáo"),
  makeCard("invoice", "hoá đơn"),
  makeCard("colleague", "đồng nghiệp"),
];

describe("learn", () => {
  it("mỗi từ: 2 câu trắc nghiệm rồi 1 câu gõ; chỉ lần chấm đầu là first attempt", () => {
    const cards = WORDS.slice(0, 3);
    const steps = runAll(engineFor({ mode: "learn", cards }));

    for (const card of cards) {
      const own = steps.filter((s) => s.question.card.id === card.id);
      expect(own.map((s) => kindGroup(s.question.kind))).toEqual(["mcq", "mcq", "type_word"]);
      expect(own.map((s) => s.record!.is_first_attempt)).toEqual([true, false, false]);
    }
    const firsts = steps.filter((s) => s.record!.is_first_attempt);
    expect(firsts).toHaveLength(cards.length);
    // hàng đủ dài thì không hỏi cùng một từ hai câu liền nhau
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].question.card.id).not.toBe(steps[i - 1].question.card.id);
    }
  });

  it("gõ sai thì về lại trắc nghiệm rồi mới gõ lại; các lần sau không phải first attempt", () => {
    const cards = WORDS.slice(0, 3);
    let failedTyping = false;
    const steps = runAll(engineFor({ mode: "learn", cards }), (question) => {
      if (question.card.term === "deadline" && question.kind === "type_word" && !failedTyping) {
        failedTyping = true;
        return false;
      }
      return true;
    });

    const deadline = steps.filter((s) => s.question.card.term === "deadline");
    expect(deadline.map((s) => kindGroup(s.question.kind))).toEqual([
      "mcq",
      "mcq",
      "type_word",
      "mcq",
      "type_word",
    ]);
    expect(deadline.map((s) => s.record!.is_correct)).toEqual([true, true, false, true, true]);
    expect(deadline.map((s) => s.record!.is_first_attempt)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("trắc nghiệm sai bị đẩy xuống cuối, vẫn phải đúng đủ 2 lần", () => {
    const cards = WORDS.slice(0, 4);
    let failed = false;
    const steps = runAll(engineFor({ mode: "learn", cards }), (question, index) => {
      if (index === 0) {
        failed = true;
        return false;
      }
      return true;
    });
    expect(failed).toBe(true);
    const first = steps[0].question.card.id;
    const own = steps.filter((s) => s.question.card.id === first);
    expect(own.map((s) => kindGroup(s.question.kind))).toEqual(["mcq", "mcq", "mcq", "type_word"]);
    expect(own.filter((s) => s.record!.is_first_attempt)).toHaveLength(1);
  });
});

describe("learnProgress", () => {
  it("chỉ tăng khi gõ đúng (từ xong), không tăng khi trắc nghiệm đúng hay gõ sai", () => {
    const engine = engineFor({ mode: "learn", cards: WORDS.slice(0, 3) });
    expect(engine.learnProgress).toEqual({ done: 0, total: 3 });
    let failedTyping = false;
    const seen: number[] = [];
    while (!engine.done) {
      const question = engine.current!;
      const typing = question.kind === "type_word";
      const correct = !(typing && !failedTyping);
      if (typing && !correct) failedTyping = true;
      const before = engine.learnProgress.done;
      engine.submit({ quality: correct ? 4 : 1, isCorrect: correct });
      const gained = engine.learnProgress.done - before;
      expect(gained).toBe(typing && correct ? 1 : 0);
      seen.push(engine.learnProgress.done);
    }
    expect(engine.learnProgress).toEqual({ done: 3, total: 3 });
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe.each(["mcq", "typing", "dictation"] as const)("%s: chèn lại câu sai", (mode) => {
  it("câu sai được hỏi lại sau 3–5 câu, cùng loại, không phải first attempt", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const engine = engineFor({ mode, cards: WORDS, rng: seededRng(seed) });
      const steps = runAll(engine, (_question, index) => index !== 0);

      const wrongId = steps[0].question.card.id;
      const again = steps.findIndex((s, i) => i > 0 && s.question.card.id === wrongId);
      const between = again - 1;
      expect(between).toBeGreaterThanOrEqual(3);
      expect(between).toBeLessThanOrEqual(5);
      expect(steps[again].question.kind).toBe(steps[0].question.kind);
      expect(steps[again].question.id).not.toBe(steps[0].question.id);
      expect(steps[again].record!.is_first_attempt).toBe(false);
      expect(engine.wrongWordIds).toEqual([wrongId]);
      expect(steps.filter((s) => s.record!.is_first_attempt)).toHaveLength(WORDS.length);
      expect(steps).toHaveLength(WORDS.length + 1);
    }
  });

  it("câu sai ở cuối hàng (hàng ngắn) được đưa xuống cuối", () => {
    const engine = engineFor({ mode, cards: WORDS.slice(0, 2) });
    const steps = runAll(engine, (_q, index) => index !== 0);
    expect(steps.map((s) => s.question.card.term)).toEqual([
      steps[0].question.card.term,
      steps[1].question.card.term,
      steps[0].question.card.term,
    ]);
  });
});

describe("review", () => {
  const newCard = makeCard("negotiate", "đàm phán", { pos: "verb", level: "new" });
  const learning = makeCard("meeting", "cuộc họp", { level: "learning" });
  const familiar = makeCard("budget", "ngân sách", { level: "familiar" });
  const mastered = makeCard("report", "báo cáo", { level: "mastered" });

  it("từ mới: thẻ flip giới thiệu không sinh answer; câu mcq_en_vi sau đó là lần đầu", () => {
    const engine = engineFor({ mode: "review", cards: [newCard, learning] });

    expect(engine.current).toMatchObject({ kind: "flip", intro: true, prompt: "negotiate" });
    expect(() => engine.submit({ quality: 4, isCorrect: true })).toThrow();
    engine.skipIntro();
    expect(engine.answers).toEqual([]);

    expect(engine.current).toMatchObject({ kind: "mcq_en_vi", prompt: "negotiate" });
    const record = engine.submit({ quality: 4, isCorrect: true });
    expect(record).toMatchObject({ word_id: newCard.id, is_first_attempt: true });
  });

  it("loại câu theo mức thuộc; tổng số answer không tính thẻ giới thiệu", () => {
    const engine = engineFor({ mode: "review", cards: [newCard, learning, familiar, mastered] });
    const steps = runAll(engine);

    expect(steps.map((s) => [s.question.card.term, s.question.kind])).toEqual([
      ["negotiate", "flip"],
      ["negotiate", "mcq_en_vi"],
      ["meeting", expect.stringMatching(/^mcq_/)],
      ["budget", "type_word"],
      ["report", "type_word"],
    ]);
    expect(steps[0].record).toBeNull();
    expect(engine.answers).toHaveLength(4);
    expect(engine.answers.every((a) => a.is_first_attempt)).toBe(true);
  });

  it("giới thiệu hết các từ mới trước, rồi mới tới phần trả lời (giữ thứ tự server)", () => {
    const second = makeCard("agenda", "chương trình họp", { level: "new" });
    const engine = engineFor({ mode: "review", cards: [learning, newCard, familiar, second] });
    const steps = runAll(engine);

    expect(steps.map((s) => [s.question.card.term, s.question.intro ? "intro" : "answer"])).toEqual([
      ["negotiate", "intro"],
      ["agenda", "intro"],
      ["meeting", "answer"],
      ["negotiate", "answer"],
      ["budget", "answer"],
      ["agenda", "answer"],
    ]);
    expect(steps.slice(0, 2).map((s) => s.question.introPosition)).toEqual([
      { index: 1, total: 2 },
      { index: 2, total: 2 },
    ]);
    expect(steps.filter((s) => s.record).every((s) => s.record!.is_first_attempt)).toBe(true);
  });

  it("thẻ giới thiệu không chiếm lần chấm đầu khi câu mcq của từ mới bị sai", () => {
    const engine = engineFor({ mode: "review", cards: [newCard, ...WORDS.slice(0, 5)] });
    let misses = 0;
    const steps = runAll(engine, (q) => q.card.id !== newCard.id || ++misses > 3); // sai 3 lần
    const own = steps.filter((s) => s.question.card.id === newCard.id && s.record);
    expect(own.map((s) => s.record!.is_first_attempt)).toEqual([true, false, false, false]);
  });
});

describe("flashcard", () => {
  it.each<[CardDirection, string, string]>([
    ["en_vi", "deadline", "hạn chót"],
    ["vi_en", "hạn chót", "deadline"],
  ])("hướng %s: mặt trước %s", (direction, front, back) => {
    const engine = engineFor({ mode: "flashcard", cards: [WORDS[0]], direction });
    expect(engine.current).toMatchObject({ kind: "flip", prompt: front, answer: back });
    expect(engine.current!.intro).toBeUndefined();
  });

  it("thẻ Quên (sai) được hỏi lại; Được/Dễ thì xong", () => {
    const engine = engineFor({ mode: "flashcard", cards: WORDS.slice(0, 2) });
    const steps = runAll(engine, (_q, index) => index !== 0);
    expect(steps).toHaveLength(3);
    expect(steps[2].question.kind).toBe("flip");
  });
});

describe("dictation", () => {
  it("mỗi thẻ một câu nghe chép: phát âm từ, đáp án là từ, không có gợi ý chữ", () => {
    const engine = engineFor({ mode: "dictation", cards: WORDS.slice(0, 3) });
    const steps = runAll(engine);
    expect(steps.map((s) => s.question.kind)).toEqual(["dictation", "dictation", "dictation"]);
    for (const { question } of steps) {
      expect(question).toMatchObject({ prompt: question.card.term, answer: question.card.term });
      expect(question.hint).toBeUndefined();
      expect(question.options).toBeUndefined();
    }
  });

  it("phiên 10 thẻ chạy trọn vẹn, mỗi từ đúng một lần chấm đầu", () => {
    const cards = Array.from({ length: 10 }, (_, i) => makeCard(`word${i}`, `nghĩa ${i}`));
    const engine = engineFor({ mode: "dictation", cards });
    const steps = runAll(engine, (_q, index) => index % 4 !== 1);
    expect(engine.done).toBe(true);
    expect(steps.filter((s) => s.record!.is_first_attempt)).toHaveLength(10);
    expect(new Set(steps.map((s) => s.question.card.id)).size).toBe(10);
  });
});

describe("speaking", () => {
  const withExamples = (term: string, examples: { en: string; vi: string }[]) => ({
    ...makeCard(term, "nghĩa"),
    examples,
  });

  it("chọn câu ví dụ có chứa từ, kèm nghĩa tiếng Việt", () => {
    const card = withExamples("deadline", [
      { en: "Time is running out.", vi: "Sắp hết giờ." },
      { en: "We missed the deadline again.", vi: "Chúng tôi lại trễ hạn." },
    ]);
    for (const seed of [1, 2, 3, 4, 5]) {
      const engine = engineFor({ mode: "speaking", cards: [card], rng: seededRng(seed) });
      expect(engine.current).toMatchObject({
        kind: "speak",
        prompt: "We missed the deadline again.",
        translation: "Chúng tôi lại trễ hạn.",
        answer: "deadline",
      });
    }
  });

  it("không câu nào chứa từ thì vẫn dùng câu ví dụ có sẵn", () => {
    const card = withExamples("meeting", [{ en: "See you at ten.", vi: "" }]);
    const engine = engineFor({ mode: "speaking", cards: [card] });
    expect(engine.current).toMatchObject({ kind: "speak", prompt: "See you at ten." });
    expect(engine.current!.translation).toBeUndefined();
  });

  it("từ chưa có câu ví dụ thì luyện nói chính từ", () => {
    const engine = engineFor({ mode: "speaking", cards: [WORDS[2]] });
    expect(engine.current).toMatchObject({ kind: "speak", prompt: "budget", answer: "budget" });
  });

  it("Chưa được (q=1) thì hỏi lại câu speak, lần sau không phải first attempt", () => {
    const engine = engineFor({ mode: "speaking", cards: WORDS.slice(0, 2) });
    const first = engine.submit({ quality: 1, isCorrect: false });
    expect(first.is_first_attempt).toBe(true);
    const steps = runAll(engine);
    expect(steps.map((s) => s.question.kind)).toEqual(["speak", "speak"]);
    expect(steps[1].question.card.id).toBe(first.word_id);
    expect(steps[1].record!.is_first_attempt).toBe(false);
  });
});

describe("AnswerRecord", () => {
  it("response_ms tính từ lúc câu hiện ra; answered_at ISO UTC; id từ newId", () => {
    let clock = 1_000;
    const engine = new StudyEngine({
      mode: "typing",
      cards: WORDS.slice(0, 2),
      rng: seededRng(1),
      newId: counterIds("answer"),
      now: () => clock,
    });

    clock = 3_500;
    expect(engine.elapsedMs).toBe(2_500);
    const first = engine.submit({ quality: 4, isCorrect: true });
    clock = 4_250;
    const second = engine.submit({ quality: 3, isCorrect: true });

    expect(first).toEqual({
      client_answer_id: "answer-1",
      word_id: engine.answers[0].word_id,
      quality: 4,
      is_correct: true,
      is_first_attempt: true,
      response_ms: 2_500,
      answered_at: "1970-01-01T00:00:03.500Z",
    });
    expect(second).toMatchObject({ client_answer_id: "answer-2", response_ms: 750, quality: 3 });
    expect(engine.done).toBe(true);
    expect(engine.progress).toEqual({ answered: 2, remaining: 0 });
    expect(() => engine.submit({ quality: 4, isCorrect: true })).toThrow();
  });

  it("mcq có 4 lựa chọn khác nhau kể cả khi phiên chỉ có 1 từ", () => {
    const engine = engineFor({ mode: "mcq", cards: [WORDS[0]] });
    const question = engine.current!;
    expect(question.options).toHaveLength(4);
    expect(new Set(question.options).size).toBe(4);
    expect(question.options).toContain(question.answer);
  });

  it("dùng distractor_pool để tạo lựa chọn", () => {
    const pool = [
      { word_id: "p1", term: "agenda", meaning_vi: "chương trình họp", part_of_speech: "noun" },
      { word_id: "p2", term: "minutes", meaning_vi: "biên bản họp", part_of_speech: "noun" },
      { word_id: "p3", term: "venue", meaning_vi: "địa điểm", part_of_speech: "noun" },
    ];
    const engine = engineFor({ mode: "mcq", cards: [WORDS[0]], distractorPool: pool });
    const question = engine.current!;
    const others = question.options!.filter((o) => o !== question.answer);
    const poolTexts = pool.flatMap((p) => [p.term, p.meaning_vi]);
    expect(others.every((o) => poolTexts.includes(o))).toBe(true);
  });
});

describe("undo", () => {
  it("flashcard vuốt nhầm (sai) rồi hoàn tác: như chưa trả lời, không chèn lại thẻ", () => {
    const engine = engineFor({ mode: "flashcard", cards: WORDS.slice(0, 6) });
    const first = engine.current!;
    const queueBefore = engine.progress.remaining;

    engine.submit({ quality: 1, isCorrect: false });
    expect(engine.canUndo).toBe(true);
    expect(engine.wrongWordIds).toEqual([first.card.id]);

    const removed = engine.undo();
    expect(removed?.word_id).toBe(first.card.id);
    expect(engine.current).toBe(first);
    expect(engine.answers).toEqual([]);
    expect(engine.wrongWordIds).toEqual([]);
    expect(engine.progress).toEqual({ answered: 0, remaining: queueBefore });
    expect(engine.canUndo).toBe(false);

    // Trả lời lại vẫn là lần chấm đầu; thẻ không còn bị hỏi lại
    const again = engine.submit({ quality: 4, isCorrect: true });
    expect(again.is_first_attempt).toBe(true);
    const steps = runAll(engine);
    expect(steps.filter((s) => s.question.card.id === first.card.id)).toHaveLength(0);
  });

  it("chỉ hoàn tác được một bước", () => {
    const engine = engineFor({ mode: "typing", cards: WORDS.slice(0, 3) });
    engine.submit({ quality: 4, isCorrect: true });
    engine.submit({ quality: 4, isCorrect: true });
    expect(engine.undo()).not.toBeNull();
    expect(engine.undo()).toBeNull();
    expect(engine.answers).toHaveLength(1);
  });

  it("learn: hoàn tác câu trắc nghiệm đúng thì số lần đúng quay về như trước", () => {
    const cards = WORDS.slice(0, 3);
    const engine = engineFor({ mode: "learn", cards });
    const wordId = engine.current!.card.id;
    engine.submit({ quality: 4, isCorrect: true });
    engine.undo();
    // Sau hoàn tác vẫn cần đúng đủ 2 câu trắc nghiệm rồi mới tới câu gõ
    const steps = runAll(engine);
    const own = steps.filter((s) => s.question.card.id === wordId);
    expect(own.map((s) => (isMcq(s.question.kind) ? "mcq" : s.question.kind))).toEqual([
      "mcq",
      "mcq",
      "type_word",
    ]);
    expect(engine.learnProgress).toEqual({ done: 3, total: 3 });
  });

  it("không hoàn tác được thẻ giới thiệu (không chấm)", () => {
    const engine = engineFor({
      mode: "review",
      cards: [makeCard("negotiate", "đàm phán", { level: "new" })],
    });
    engine.skipIntro();
    expect(engine.canUndo).toBe(false);
    expect(engine.undo()).toBeNull();
    expect(engine.current?.kind).toBe("mcq_en_vi");
  });
});
