import { describe, expect, it } from "@jest/globals";

import type { DailyStat } from "@/api/types";

import { buildHeatmap, formatHeatDate, HEATMAP_DAYS, heatLevel, monthLabels, weekdayOf } from "../heatmap";

/** `count` ngày liên tiếp kết thúc ở `lastDate`, cards_done lấy từ `cards` (mặc định 0). */
function makeDays(lastDate: string, count: number, cards: (i: number) => number = () => 0): DailyStat[] {
  const end = new Date(`${lastDate}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    cards_done: cards(i),
    correct: 0,
    new_words: 0,
    study_seconds: 0,
  }));
}

describe("weekdayOf", () => {
  it.each([
    ["2026-10-12", 0], // Thứ 2
    ["2026-10-16", 4], // Thứ 6
    ["2026-10-18", 6], // Chủ nhật
  ])("%s -> %i", (date, expected) => {
    expect(weekdayOf(date)).toBe(expected);
  });
});

describe("heatLevel", () => {
  it.each([
    [0, 0],
    [1, 1],
    [9, 1],
    [10, 2],
    [19, 2],
    [20, 3],
    [39, 3],
    [40, 4],
    [500, 4],
  ])("%i thẻ với mục tiêu 20 -> bậc %i", (cards, level) => {
    expect(heatLevel(cards, 20)).toBe(level);
  });

  it("mục tiêu 0 không chia cho 0", () => {
    expect(heatLevel(1, 0)).toBe(3);
  });
});

describe("buildHeatmap", () => {
  it("hôm nay ở cột cuối đúng hàng thứ, bỏ ngày cũ hơn cột đầu", () => {
    const cells = buildHeatmap(makeDays("2026-10-16", HEATMAP_DAYS), 20); // Thứ 6
    expect(cells).toHaveLength(11 * 7 + 5);
    expect(cells.at(-1)).toMatchObject({ date: "2026-10-16", week: 11, weekday: 4 });
    expect(cells[0]).toMatchObject({ date: "2026-07-27", week: 0, weekday: 0 });
  });

  it("hôm nay là Chủ nhật thì lấp đủ 84 ô", () => {
    const cells = buildHeatmap(makeDays("2026-10-18", HEATMAP_DAYS), 20);
    expect(cells).toHaveLength(HEATMAP_DAYS);
    expect(cells.at(-1)).toMatchObject({ week: 11, weekday: 6 });
  });

  it("mang theo số thẻ và bậc màu", () => {
    const cells = buildHeatmap(makeDays("2026-10-16", 3, (i) => [0, 5, 45][i]), 20);
    expect(cells.map((c) => [c.cardsDone, c.level])).toEqual([
      [0, 0],
      [5, 1],
      [45, 4],
    ]);
  });

  it("danh sách rỗng", () => {
    expect(buildHeatmap([], 20)).toEqual([]);
  });
});

describe("monthLabels", () => {
  it("đặt nhãn ở cột chứa ngày 1, bỏ nhãn đầu nếu sát nhãn kế", () => {
    const cells = buildHeatmap(makeDays("2026-10-16", HEATMAP_DAYS), 20);
    // Lưới bắt đầu 27/07: nhãn Thg 7 ở cột 0 sát Thg 8 ở cột 0 -> bỏ
    expect(monthLabels(cells)).toEqual([
      { week: 0, label: "Thg 8" },
      { week: 5, label: "Thg 9" },
      { week: 9, label: "Thg 10" },
    ]);
  });
});

describe("formatHeatDate", () => {
  it("ghi thứ và ngày/tháng", () => {
    expect(formatHeatDate("2026-10-16")).toBe("Thứ 6, 16/10");
    expect(formatHeatDate("2026-10-18")).toBe("Chủ nhật, 18/10");
  });
});
