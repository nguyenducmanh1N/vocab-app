import { describe, expect, it } from "@jest/globals";
import { normalize } from "../grading";
import { FALLBACK, pickOptions, toCandidate } from "../distractors";
import { seededRng } from "../random";
import type { Candidate } from "../types";
import { makeCard } from "../__fixtures__/cards";

const candidate = (term: string, meaning: string, pos: string | null = "noun"): Candidate => ({
  word_id: `id-${term}`,
  term,
  meaning_vi: meaning,
  part_of_speech: pos,
});

function expectFourDistinct(options: string[], correct: string): void {
  expect(options).toHaveLength(4);
  expect(options).toContain(correct);
  expect(new Set(options.map(normalize)).size).toBe(4);
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

describe("pickOptions", () => {
  const card = toCandidate(makeCard("deadline", "hạn chót"));

  it("đủ 4 lựa chọn khác nhau, có đáp án đúng", () => {
    const pool = [
      candidate("meeting", "cuộc họp"),
      candidate("budget", "ngân sách"),
      candidate("report", "báo cáo"),
      candidate("invoice", "hoá đơn"),
    ];
    for (const seed of SEEDS) {
      expectFourDistinct(pickOptions(card, pool, "meaning_vi", seededRng(seed)), "hạn chót");
      expectFourDistinct(pickOptions(card, pool, "term", seededRng(seed)), "deadline");
    }
  });

  it("ưu tiên cùng part_of_speech", () => {
    const pool = [
      candidate("meeting", "cuộc họp"),
      candidate("budget", "ngân sách"),
      candidate("report", "báo cáo"),
      candidate("negotiate", "đàm phán", "verb"),
      candidate("urgent", "khẩn cấp", "adjective"),
      candidate("quickly", "nhanh chóng", "adverb"),
    ];
    for (const seed of SEEDS) {
      const options = pickOptions(card, pool, "term", seededRng(seed));
      expect(new Set(options)).toEqual(new Set(["deadline", "meeting", "budget", "report"]));
    }
  });

  it("không có hai lựa chọn trùng chữ hiển thị (khác id nhưng cùng nghĩa)", () => {
    const pool = [
      candidate("due date", "Hạn chót "), // trùng nghĩa với đáp án đúng sau normalize
      candidate("cutoff", "hạn chót"),
      candidate("meeting", "cuộc họp"),
      candidate("session", "cuộc họp"), // trùng nhau
      candidate("budget", "ngân sách"),
      candidate("report", "báo cáo"),
    ];
    for (const seed of SEEDS) {
      const options = pickOptions(card, pool, "meaning_vi", seededRng(seed));
      expectFourDistinct(options, "hạn chót");
      expect(options.filter((o) => normalize(o) === "hạn chót")).toHaveLength(1);
    }
  });

  it("không lấy chính thẻ đó từ danh sách ứng viên", () => {
    const pool = [card, candidate("meeting", "cuộc họp")];
    const options = pickOptions(card, pool, "term", seededRng(1));
    expect(options.filter((o) => o === "deadline")).toHaveLength(1);
  });

  it("list chỉ 1 từ, không có distractor_pool → vẫn đủ 4 nhờ danh sách dự phòng", () => {
    for (const seed of SEEDS) {
      const options = pickOptions(card, [card], "meaning_vi", seededRng(seed));
      expectFourDistinct(options, "hạn chót");
      const fallbackMeanings = new Set(FALLBACK.map((f) => f.meaning_vi));
      expect(options.filter((o) => o !== "hạn chót").every((o) => fallbackMeanings.has(o))).toBe(
        true,
      );
    }
  });

  it("list ít từ: dùng từ của user trước, thiếu mới lấy dự phòng", () => {
    const pool = [candidate("meeting", "cuộc họp"), candidate("budget", "ngân sách")];
    for (const seed of SEEDS) {
      const options = pickOptions(card, pool, "meaning_vi", seededRng(seed));
      expectFourDistinct(options, "hạn chót");
      expect(options).toEqual(expect.arrayContaining(["cuộc họp", "ngân sách"]));
    }
  });

  it("đáp án đúng trùng một từ dự phòng thì từ đó không bị lấy lại", () => {
    const water = toCandidate(makeCard("water", "nước"));
    for (const seed of SEEDS) {
      expectFourDistinct(pickOptions(water, [], "term", seededRng(seed)), "water");
    }
  });
});
