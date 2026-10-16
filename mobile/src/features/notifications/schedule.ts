/**
 * Lịch thông báo cục bộ (PLAN.md 10.5): hàm thuần, test bằng jest.
 * Giờ tính theo múi giờ của máy (thông báo cục bộ chạy theo đồng hồ của máy).
 */
import type { FeedItem, NotifySettings } from "@/api/types";

export const MAX_SCHEDULED = 60; // iOS giữ tối đa 64 thông báo chờ mỗi app
export const DAYS_AHEAD = 7;
export const STREAK_GUARD_TIME = "21:30";
export const STREAK_MIN_CARDS = 10; // ngưỡng giữ streak (9.5)

export type PlannedNotification = {
  kind: "word" | "reminder" | "streak";
  date: Date;
  title: string;
  body: string;
  data: { url: string };
};

/** "HH:MM" → số phút từ 00:00. */
export function parseHHMM(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Giờ không hợp lệ: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Giờ không hợp lệ: ${value}`);
  return hours * 60 + minutes;
}

/** Thời điểm `minutes` phút sau 00:00 của ngày (now + offset ngày), theo giờ máy. */
export function atLocalMinutes(now: Date, dayOffset: number, minutes: number): Date {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0, 0);
  date.setMinutes(minutes);
  return date;
}

/**
 * Mốc giờ đẩy từ: mỗi ngày `perDay` mốc chia đều trong khung (mốc i ở vị trí (i + 0.5)/perDay,
 * nên một mốc thì nằm giữa khung); bỏ các mốc đã qua.
 */
export function wordPushSlots(
  now: Date,
  options: { days: number; perDay: number; windowStart: string; windowEnd: string },
): Date[] {
  const start = parseHHMM(options.windowStart);
  const end = parseHHMM(options.windowEnd);
  if (options.perDay <= 0 || end <= start) return [];
  const slots: Date[] = [];
  for (let day = 0; day < options.days; day++) {
    for (let i = 0; i < options.perDay; i++) {
      const minutes = Math.round(start + ((end - start) * (i + 0.5)) / options.perDay);
      const slot = atLocalMinutes(now, day, minutes);
      if (slot.getTime() > now.getTime()) slots.push(slot);
    }
  }
  return slots;
}

function wordNotification(item: FeedItem, date: Date): PlannedNotification {
  return {
    kind: "word",
    date,
    title: item.part_of_speech ? `${item.term} (${item.part_of_speech})` : item.term,
    body: item.example_en ? `${item.meaning_vi} — ${item.example_en}` : item.meaning_vi,
    data: { url: `/word/${item.word_id}` },
  };
}

/**
 * Toàn bộ lịch chờ: nhắc học 7 ngày, giữ streak tối nay, thông báo từ vựng.
 * Tổng không quá 60: ưu tiên nhắc học và giữ streak, phần còn lại cho thông báo từ.
 */
export function buildSchedule(input: {
  now: Date;
  notify: NotifySettings;
  feed: readonly FeedItem[];
  dueToday: number;
  cardsToday: number;
}): PlannedNotification[] {
  const { now, notify, feed, dueToday, cardsToday } = input;
  const essentials: PlannedNotification[] = [];

  if (notify.daily_reminder) {
    const minutes = parseHHMM(notify.reminder_time);
    for (let day = 0; day < DAYS_AHEAD; day++) {
      const date = atLocalMinutes(now, day, minutes);
      if (date.getTime() <= now.getTime()) continue;
      essentials.push({
        kind: "reminder",
        date,
        title: "Ôn tập hôm nay",
        body:
          day === 0 && dueToday > 0
            ? `Hôm nay có ${dueToday} từ đến hạn ôn. Vào học vài phút nhé!`
            : "Dành vài phút ôn từ vựng hôm nay nhé!",
        data: { url: "/" },
      });
    }
  }

  if (notify.streak_guard && cardsToday < STREAK_MIN_CARDS) {
    const date = atLocalMinutes(now, 0, parseHHMM(STREAK_GUARD_TIME));
    if (date.getTime() > now.getTime()) {
      essentials.push({
        kind: "streak",
        date,
        title: "Giữ chuỗi ngày học 🔥",
        body: `Hôm nay bạn mới học ${cardsToday}/${STREAK_MIN_CARDS} thẻ. Học thêm để không mất chuỗi!`,
        data: { url: "/" },
      });
    }
  }

  const words: PlannedNotification[] = [];
  if (notify.word_push && notify.word_push_per_day > 0) {
    const slots = wordPushSlots(now, {
      days: DAYS_AHEAD,
      perDay: notify.word_push_per_day,
      windowStart: notify.window_start,
      windowEnd: notify.window_end,
    });
    slots.forEach((slot, index) => {
      const item = feed[index];
      if (item) words.push(wordNotification(item, slot));
    });
  }

  const kept = [...essentials, ...words.slice(0, Math.max(0, MAX_SCHEDULED - essentials.length))];
  return kept.sort((a, b) => a.date.getTime() - b.date.getTime());
}
