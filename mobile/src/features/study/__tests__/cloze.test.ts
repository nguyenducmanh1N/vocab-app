import { describe, expect, it } from "@jest/globals";

import { makeCloze } from "@/utils/cloze";

import { StudyEngine } from "../engine";
import { CLOZE_BLANK, clozeForm } from "../generators";
import { gradeClozeAnswer } from "../grading";
import { seededRng } from "../random";
import type { Question, StudyCard } from "../types";
import { counterIds, makeCard } from "../__fixtures__/cards";

function card(term: string, sentences: string[]): StudyCard {
  return { ...makeCard(term, `nghĩa ${term}`), examples: sentences.map((en) => ({ en, vi: `vi: ${en}` })) };
}

function engineFor(cards: StudyCard[], seed = 7) {
  return new StudyEngine({ mode: "cloze", cards, rng: seededRng(seed), newId: counterIds(), now: () => 0 });
}

/** Chạy hết phiên, câu thứ `wrongAt` trả lời sai; trả mọi câu đã hiện. */
function runAll(engine: StudyEngine, wrongAt = -1): Question[] {
  const shown: Question[] = [];
  for (let guard = 0; !engine.done; guard++) {
    if (guard > 200) throw new Error("Phiên không kết thúc");
    shown.push(engine.current!);
    const correct = shown.length - 1 !== wrongAt;
    engine.submit({ quality: correct ? 4 : 1, isCorrect: correct });
  }
  return shown;
}

const countBlanks = (text: string) => text.split(CLOZE_BLANK).length - 1;

// Đủ kiểu câu: từ ở đầu câu viết hoa, viết hoa toàn bộ, cụm từ, có đuôi chia, sát dấu câu,
// và các từ không đủ điều kiện (chỉ là một phần của từ khác, không có câu, câu rỗng, câu có sẵn ____).
const CARDS: StudyCard[] = [
  card("deadline", ["Deadline is tomorrow."]),
  card("budget", ["THE BUDGET IS TIGHT."]),
  card("meeting", ["The meeting starts at nine.", "No example here."]),
  card("take off", ["The plane takes off at noon."]),
  card("report", ["She reported the bug.", "Send the report, please!"]),
  card("invoice", ["(Invoice) attached."]),
  card("cat", ["Pick a category."]), // "cat" chỉ là một phần của "category"
  card("colleague", []),
  card("agenda", ["   "]),
  card("memo", ["Write the ____ now."]), // câu đã có ____ sẽ thành hai chỗ trống
  card("Monday", ["See you on monday."]),
];
const ELIGIBLE = ["deadline", "budget", "meeting", "take off", "report", "invoice", "Monday"];

describe("cloze: không bao giờ sinh câu thiếu chỗ trống", () => {
  it("mọi câu hỏi (kể cả câu hỏi lại) có đúng một ____ và che đúng chữ trong câu gốc", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const questions = runAll(engineFor(CARDS, seed), seed % 5);
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) {
        expect(question.kind).toBe("cloze");
        expect(countBlanks(question.prompt)).toBe(1);
        // prompt là một câu ví dụ của từ, chỗ trống nằm đúng vị trí chữ bị che
        const source = question.card.examples.find((example) => {
          const parts = makeCloze(example.en, question.card.term);
          return parts && `${parts.before}${CLOZE_BLANK}${parts.after}` === question.prompt;
        });
        expect(source).toBeDefined();
      }
    }
  });

  it("chỉ nhận từ có câu ví dụ chứa chính từ đó; báo đủ số từ bị bỏ", () => {
    const engine = engineFor(CARDS);
    const terms = runAll(engine).map((q) => q.card.term);
    expect(new Set(terms)).toEqual(new Set(ELIGIBLE));
    expect(engine.skippedWordIds).toEqual(["id-cat", "id-colleague", "id-agenda", "id-memo"]);
  });

  it("không từ nào đủ điều kiện: phiên rỗng, mọi từ bị báo bỏ", () => {
    const engine = engineFor([card("cat", ["Pick a category."]), card("dog", [])]);
    expect(engine.done).toBe(true);
    expect(engine.current).toBeNull();
    expect(engine.skippedWordIds).toHaveLength(2);
  });
});

describe("cloze: từ viết hoa ở đầu câu vẫn che được", () => {
  it.each([
    ["deadline", "Deadline is tomorrow.", "Deadline"],
    ["budget", "THE BUDGET IS TIGHT.", "BUDGET"],
    ["Monday", "monday again?", "monday"],
    ["take off", "Takes off at noon.", "Takes off"],
  ])("%s trong “%s”", (term, sentence, hidden) => {
    const engine = engineFor([card(term, [sentence])]);
    const question = engine.current!;
    expect(question.prompt).toBe(sentence.replace(hidden, CLOZE_BLANK));
    expect(question.prompt.toLowerCase()).not.toContain(term.toLowerCase());
  });
});

describe("cloze: dạng chọn và dạng gõ", () => {
  const words = ["deadline", "budget", "meeting", "report", "invoice"].map((term) =>
    card(term, [`This ${term} matters.`]),
  );

  it("xen kẽ chọn / gõ; dạng chọn có 4 lựa chọn chứa đáp án là từ", () => {
    const questions = runAll(engineFor(words));
    expect(questions.map(clozeForm)).toEqual(["choose", "type", "choose", "type", "choose"]);
    for (const question of questions.filter((q) => clozeForm(q) === "choose")) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.options).toContain(question.card.term);
      expect(question.answer).toBe(question.card.term);
    }
  });

  it("câu sai được hỏi lại đúng dạng cũ, không phải first attempt", () => {
    for (const wrongAt of [0, 1]) {
      const engine = engineFor(words);
      const questions = runAll(engine, wrongAt);
      const again = questions.findIndex((q, i) => i > wrongAt && q.card.id === questions[wrongAt].card.id);
      expect(again).toBeGreaterThan(wrongAt);
      expect(clozeForm(questions[again])).toBe(clozeForm(questions[wrongAt]));
      expect(countBlanks(questions[again].prompt)).toBe(1);
      expect(engine.answers[again].is_first_attempt).toBe(false);
    }
  });

  it("dạng gõ: đáp án là đúng chữ bị che (có đuôi chia); từ bị bỏ không làm lệch xen kẽ", () => {
    const engine = engineFor([
      card("deadline", ["The deadline is near."]),
      card("budget", ["Plans first."]), // không đủ điều kiện
      card("report", ["She reported it."]),
    ]);
    const [first, second] = runAll(engine);
    expect(clozeForm(first)).toBe("choose");
    expect(second).toMatchObject({ prompt: `She ${CLOZE_BLANK} it.`, answer: "reported" });
    expect(clozeForm(second)).toBe("type");
    expect(second.translation).toBe("vi: She reported it.");
    expect(engine.skippedWordIds).toEqual(["id-budget"]);
  });
});

describe("gradeClozeAnswer", () => {
  it.each([
    ["reported", "correct"],
    ["Reported ", "correct"],
    ["report", "correct"], // dạng gốc của từ cũng đúng
    ["reportd", "near"], // sai 1 ký tự, đáp án dài ≥ 7
    ["repair", "wrong"],
    ["", "wrong"],
  ])("“%s” → %s", (input, expected) => {
    expect(gradeClozeAnswer(input, "reported", "report").grade).toBe(expected);
  });
});
