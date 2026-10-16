import type { DailyStat } from "@/api/types";

export const HEATMAP_WEEKS = 12;
/** Số ngày lấy từ /stats/daily: đủ 12 tuần dù hôm nay là thứ mấy. */
export const HEATMAP_DAYS = HEATMAP_WEEKS * 7;

/** 0 = không học, 1–4 = bốn bậc màu. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export type HeatCell = {
  date: string; // YYYY-MM-DD
  cardsDone: number;
  level: HeatLevel;
  week: number; // cột 0..11, 11 là tuần hiện tại
  weekday: number; // hàng 0 = Thứ 2 … 6 = Chủ nhật
};

const WEEKDAY_NAMES = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

/** Thứ trong tuần của "YYYY-MM-DD", 0 = Thứ 2 … 6 = Chủ nhật (không phụ thuộc múi giờ máy). */
export function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Bậc màu theo mục tiêu ngày: 1 dưới nửa mục tiêu, 2 từ nửa tới dưới mục tiêu,
 * 3 đạt mục tiêu, 4 từ gấp đôi mục tiêu trở lên.
 */
export function heatLevel(cardsDone: number, goal: number): HeatLevel {
  if (cardsDone <= 0) return 0;
  const target = Math.max(1, goal);
  if (cardsDone >= target * 2) return 4;
  if (cardsDone >= target) return 3;
  if (cardsDone * 2 >= target) return 2;
  return 1;
}

/**
 * Xếp `days` (tăng dần, phần tử cuối là hôm nay) vào lưới 12 cột tuần × 7 hàng (T2…CN).
 * Cột cuối là tuần hiện tại, chỉ tới hôm nay; ngày cũ hơn cột đầu bị bỏ.
 */
export function buildHeatmap(days: DailyStat[], goal: number): HeatCell[] {
  if (days.length === 0) return [];
  const lastIndex = (HEATMAP_WEEKS - 1) * 7 + weekdayOf(days[days.length - 1].date);
  const cells: HeatCell[] = [];
  days.forEach((day, i) => {
    const index = lastIndex - (days.length - 1 - i);
    if (index < 0) return;
    cells.push({
      date: day.date,
      cardsDone: day.cards_done,
      level: heatLevel(day.cards_done, goal),
      week: Math.floor(index / 7),
      weekday: index % 7,
    });
  });
  return cells;
}

/** Nhãn tháng đặt ở cột chứa ngày đầu tiên của tháng trong lưới; bỏ nhãn đầu nếu sát nhãn sau (chồng chữ). */
export function monthLabels(cells: HeatCell[]): { week: number; label: string }[] {
  const labels: { week: number; label: string }[] = [];
  let lastMonth = "";
  for (const cell of cells) {
    const month = cell.date.slice(5, 7);
    if (month !== lastMonth) {
      labels.push({ week: cell.week, label: `Thg ${Number(month)}` });
      lastMonth = month;
    }
  }
  if (labels.length > 1 && labels[1].week - labels[0].week < 3) labels.shift();
  return labels;
}

/** "Thứ 6, 16/10" */
export function formatHeatDate(date: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
