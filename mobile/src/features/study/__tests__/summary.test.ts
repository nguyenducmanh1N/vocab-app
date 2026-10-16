import { describe, expect, it } from "@jest/globals";

import { formatDuration, retrySource, summarize, type SessionRecord } from "../summary";
import type { AnswerRecord } from "../types";
import { makeCard } from "../__fixtures__/cards";

const CARDS = [
  makeCard("deadline", "hạn chót"),
  makeCard("meeting", "cuộc họp"),
  makeCard("budget", "ngân sách"),
];

function answer(wordId: string, correct: boolean, first: boolean): AnswerRecord {
  return {
    client_answer_id: `${wordId}-${Math.random()}`,
    word_id: wordId,
    quality: correct ? 4 : 1,
    is_correct: correct,
    is_first_attempt: first,
    response_ms: 1000,
    answered_at: "2026-10-15T03:00:00.000Z",
  };
}

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    mode: "mcq",
    listId: "list-1",
    startedAt: "2026-10-15T03:00:00.000Z",
    endedAt: "2026-10-15T03:04:05.000Z",
    // meeting sai rồi được hỏi lại và đúng; budget sai cả hai lần
    answers: [
      answer("id-deadline", true, true),
      answer("id-meeting", false, true),
      answer("id-budget", false, true),
      answer("id-meeting", true, false),
      answer("id-budget", false, false),
    ],
    cards: CARDS,
    distractorPool: [
      { word_id: "pool-1", term: "invoice", meaning_vi: "hoá đơn", part_of_speech: "noun" },
      { word_id: "id-deadline", term: "deadline", meaning_vi: "hạn chót", part_of_speech: "noun" },
    ],
    wrongWordIds: ["id-meeting", "id-budget"],
    ...overrides,
  };
}

describe("summarize", () => {
  it("đếm mọi câu trả lời, kể cả câu hỏi lại (giống study_sessions.total/correct)", () => {
    const summary = summarize(record());
    expect(summary).toMatchObject({ total: 5, correct: 2, wrong: 3, durationSec: 245 });
  });

  it("từ sai theo thứ tự sai đầu tiên, không trùng", () => {
    const summary = summarize(record({ wrongWordIds: ["id-budget", "id-meeting", "id-budget"] }));
    expect(summary.wrongCards.map((c) => c.term)).toEqual(["budget", "meeting"]);
  });

  it("thời gian tối đa 2 giờ như server, không âm", () => {
    expect(summarize(record({ endedAt: "2026-10-15T06:00:00.000Z" })).durationSec).toBe(7200);
    expect(summarize(record({ endedAt: "2026-10-15T02:59:00.000Z" })).durationSec).toBe(0);
  });
});

describe("retrySource", () => {
  it("chỉ có thẻ sai; pool gồm pool cũ và thẻ đúng, không chứa thẻ sai, không trùng", () => {
    const source = retrySource(record());
    expect(source.cards.map((c) => c.term)).toEqual(["meeting", "budget"]);
    const poolIds = source.distractor_pool.map((p) => p.word_id);
    expect(poolIds.sort()).toEqual(["id-deadline", "pool-1"]);
  });

  it("không sai câu nào thì không có thẻ để ôn lại", () => {
    expect(retrySource(record({ wrongWordIds: [] })).cards).toEqual([]);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 giây"],
    [45, "45 giây"],
    [60, "1 phút"],
    [245, "4 phút 5 giây"],
    [7200, "120 phút"],
  ])("%d giây → %s", (sec, text) => {
    expect(formatDuration(sec)).toBe(text);
  });
});
