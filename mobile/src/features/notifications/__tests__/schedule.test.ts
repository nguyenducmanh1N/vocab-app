import { describe, expect, it } from "@jest/globals";

import type { FeedItem, NotifySettings } from "@/api/types";

import { buildSchedule, MAX_SCHEDULED, parseHHMM, wordPushSlots } from "../schedule";

// 15/10/2026 07:00 theo giờ máy (test dùng giờ địa phương như app)
const MORNING = new Date(2026, 9, 15, 7, 0);

const hhmm = (date: Date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const NOTIFY: NotifySettings = {
  daily_reminder: true,
  reminder_time: "20:00",
  word_push: true,
  word_push_per_day: 3,
  window_start: "08:00",
  window_end: "22:00",
  streak_guard: true,
};

function feedItems(count: number): FeedItem[] {
  return Array.from({ length: count }, (_, i) => ({
    word_id: `w${i}`,
    term: `term${i}`,
    part_of_speech: i % 2 ? null : "noun",
    meaning_vi: `nghĩa ${i}`,
    example_en: i % 3 ? `Example ${i}.` : null,
    example_vi: null,
  }));
}

describe("parseHHMM", () => {
  it("đổi HH:MM ra phút, từ chối giá trị sai", () => {
    expect(parseHHMM("08:30")).toBe(510);
    expect(parseHHMM("0:05")).toBe(5);
    expect(() => parseHHMM("24:00")).toThrow();
    expect(() => parseHHMM("8h")).toThrow();
  });
});

describe("wordPushSlots", () => {
  it("1 mốc mỗi ngày thì lấy giữa khung", () => {
    const slots = wordPushSlots(MORNING, { days: 2, perDay: 1, windowStart: "08:00", windowEnd: "22:00" });
    expect(slots.map(hhmm)).toEqual(["15:00", "15:00"]);
    expect(slots[1].getDate() - slots[0].getDate()).toBe(1);
  });

  it("nhiều mốc chia đều trong khung", () => {
    const slots = wordPushSlots(MORNING, { days: 1, perDay: 3, windowStart: "09:00", windowEnd: "18:00" });
    expect(slots.map(hhmm)).toEqual(["10:30", "13:30", "16:30"]);
  });

  it("bỏ các mốc đã qua (giữa khung)", () => {
    const noon = new Date(2026, 9, 15, 12, 0);
    const slots = wordPushSlots(noon, { days: 2, perDay: 3, windowStart: "09:00", windowEnd: "18:00" });
    expect(slots.map((s) => `${s.getDate()} ${hhmm(s)}`)).toEqual([
      "15 13:30",
      "15 16:30",
      "16 10:30",
      "16 13:30",
      "16 16:30",
    ]);
  });

  it("khung sai hoặc 0 mốc thì không có lịch", () => {
    expect(wordPushSlots(MORNING, { days: 7, perDay: 0, windowStart: "08:00", windowEnd: "22:00" })).toEqual([]);
    expect(wordPushSlots(MORNING, { days: 7, perDay: 3, windowStart: "22:00", windowEnd: "08:00" })).toEqual([]);
  });
});

describe("buildSchedule", () => {
  it("tổng lịch không quá 60, vẫn giữ đủ nhắc học và giữ streak", () => {
    const plan = buildSchedule({
      now: MORNING,
      notify: { ...NOTIFY, word_push_per_day: 5 },
      feed: feedItems(35),
      dueToday: 4,
      cardsToday: 0,
    });
    expect(plan.length).toBeLessThanOrEqual(MAX_SCHEDULED);
    expect(plan.filter((n) => n.kind === "reminder")).toHaveLength(7);
    expect(plan.filter((n) => n.kind === "streak")).toHaveLength(1);
    expect(plan.filter((n) => n.kind === "word")).toHaveLength(35);
    const times = plan.map((n) => n.date.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times.every((t) => t > MORNING.getTime())).toBe(true);
  });

  it("cắt thông báo từ khi vượt 60 (ưu tiên nhắc học, giữ streak)", () => {
    const many = Array.from({ length: 80 }, (_, i) => feedItems(1).map((f) => ({ ...f, word_id: `x${i}` }))[0]);
    const plan = buildSchedule({
      now: new Date(2026, 9, 15, 0, 1),
      notify: { ...NOTIFY, word_push_per_day: 12 },
      feed: many,
      dueToday: 0,
      cardsToday: 0,
    });
    expect(plan).toHaveLength(MAX_SCHEDULED);
    expect(plan.filter((n) => n.kind !== "word")).toHaveLength(8);
  });

  it("10 từ mỗi ngày (mức cao nhất): vẫn không quá 60, giữ đủ nhắc học, đẩy từ theo thứ tự thời gian", () => {
    const plan = buildSchedule({
      now: MORNING,
      notify: { ...NOTIFY, word_push_per_day: 10 },
      feed: feedItems(70),
      dueToday: 2,
      cardsToday: 0,
    });
    expect(plan).toHaveLength(MAX_SCHEDULED);
    expect(plan.filter((n) => n.kind === "reminder")).toHaveLength(7);
    const words = plan.filter((n) => n.kind === "word");
    expect(words).toHaveLength(MAX_SCHEDULED - 8); // 7 nhắc học + 1 giữ streak
    expect(words.map((n) => n.data.url).slice(0, 3)).toEqual(["/word/w0", "/word/w1", "/word/w2"]);
  });

  it("nội dung thông báo từ vựng và đường dẫn mở Chi tiết từ", () => {
    const plan = buildSchedule({
      now: MORNING,
      notify: { ...NOTIFY, daily_reminder: false, streak_guard: false, word_push_per_day: 1 },
      feed: feedItems(3),
      dueToday: 0,
      cardsToday: 0,
    });
    expect(plan.slice(0, 2)).toEqual([
      {
        kind: "word",
        date: new Date(2026, 9, 15, 15, 0),
        title: "term0 (noun)",
        body: "nghĩa 0",
        data: { url: "/word/w0" },
      },
      {
        kind: "word",
        date: new Date(2026, 9, 16, 15, 0),
        title: "term1",
        body: "nghĩa 1 — Example 1.",
        data: { url: "/word/w1" },
      },
    ]);
    expect(plan).toHaveLength(3); // feed chỉ có 3 từ
  });

  it("tắt thông báo từ vựng thì chỉ còn nhắc học", () => {
    const plan = buildSchedule({
      now: MORNING,
      notify: { ...NOTIFY, word_push: false, streak_guard: false },
      feed: feedItems(10),
      dueToday: 5,
      cardsToday: 20,
    });
    expect(plan.map((n) => n.kind)).toEqual(Array(7).fill("reminder"));
    expect(plan[0].body).toContain("5 từ đến hạn");
    expect(plan[1].body).not.toContain("đến hạn");
    expect(hhmm(plan[0].date)).toBe("20:00");
  });

  it("giữ streak: chỉ khi chưa đủ 10 thẻ và còn trước 21:30", () => {
    const base = { notify: { ...NOTIFY, daily_reminder: false, word_push: false }, feed: [], dueToday: 0 };
    const streak = (now: Date, cardsToday: number) =>
      buildSchedule({ ...base, now, cardsToday }).filter((n) => n.kind === "streak");

    expect(streak(MORNING, 3).map((n) => hhmm(n.date))).toEqual(["21:30"]);
    expect(streak(MORNING, 10)).toEqual([]);
    expect(streak(new Date(2026, 9, 15, 21, 45), 0)).toEqual([]);
  });

  it("nhắc học hôm nay bị bỏ khi đã qua giờ nhắc", () => {
    const evening = new Date(2026, 9, 15, 20, 30);
    const plan = buildSchedule({
      now: evening,
      notify: { ...NOTIFY, word_push: false, streak_guard: false },
      feed: [],
      dueToday: 3,
      cardsToday: 0,
    });
    expect(plan).toHaveLength(6);
    expect(plan[0].date.getDate()).toBe(16);
    expect(plan[0].body).not.toContain("đến hạn"); // ngày sau dùng câu chung
  });
});
