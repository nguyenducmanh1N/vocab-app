import { describe, expect, it } from "@jest/globals";

import { buildSessionPayload, type SessionMeta } from "../session";
import type { AnswerRecord } from "../types";

const META: SessionMeta = {
  clientSessionId: "session-1",
  listId: null,
  mode: "flashcard",
  startedAt: "2026-10-15T03:00:00.000Z",
};

const answer = (n: number): AnswerRecord => ({
  client_answer_id: `a-${n}`,
  word_id: `w-${n}`,
  quality: 4,
  is_correct: true,
  is_first_attempt: true,
  response_ms: 1000,
  answered_at: `2026-10-15T03:00:0${n}.000Z`,
});

describe("buildSessionPayload", () => {
  const answers = [answer(1), answer(2), answer(3)];

  it("kết thúc phiên: gửi mọi câu chưa gửi kèm finished và ended_at", () => {
    expect(
      buildSessionPayload(META, answers, 0, { finished: true, endedAt: "2026-10-15T03:05:00.000Z" }),
    ).toEqual({
      client_session_id: "session-1",
      list_id: null,
      mode: "flashcard",
      started_at: "2026-10-15T03:00:00.000Z",
      finished: true,
      ended_at: "2026-10-15T03:05:00.000Z",
      answers,
    });
  });

  it("chỉ gửi các câu sau vị trí đã gửi", () => {
    const payload = buildSessionPayload(META, answers, 2, { finished: false });
    expect(payload.answers.map((a) => a.client_answer_id)).toEqual(["a-3"]);
    expect(payload.finished).toBe(false);
    expect(payload.ended_at).toBeNull(); // chưa kết thúc thì không gửi ended_at
  });

  it("giữ list_id khi học theo list", () => {
    const payload = buildSessionPayload({ ...META, listId: "list-9" }, answers, 3, {
      finished: true,
      endedAt: "2026-10-15T03:05:00.000Z",
    });
    expect(payload.list_id).toBe("list-9");
    expect(payload.answers).toEqual([]);
  });

  it("chia lô 10 câu: mỗi lô chỉ chứa câu mới, lô cuối có finished", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ ...answer(1), client_answer_id: `a-${i + 1}` }));
    const batches = [
      buildSessionPayload(META, many.slice(0, 10), 0, { finished: false }),
      buildSessionPayload(META, many.slice(0, 20), 10, { finished: false }),
      buildSessionPayload(META, many, 20, { finished: true, endedAt: "2026-10-15T03:10:00.000Z" }),
    ];
    expect(batches.map((b) => b.answers.length)).toEqual([10, 10, 3]);
    expect(batches.flatMap((b) => b.answers.map((a) => a.client_answer_id))).toEqual(
      many.map((a) => a.client_answer_id),
    );
    expect(batches.map((b) => b.finished)).toEqual([false, false, true]);
    expect(new Set(batches.map((b) => b.client_session_id)).size).toBe(1);
  });
});
