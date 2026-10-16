import type { Level } from "@/api/types";

export const LEVEL_LABELS: Record<Level, string> = {
  new: "Mới",
  learning: "Đang học",
  familiar: "Quen",
  mastered: "Thuộc",
};

/** Lớp màu chữ theo mức thuộc (token). */
export const LEVEL_TEXT_CLASS: Record<Level, string> = {
  new: "text-textMuted",
  learning: "text-warning",
  familiar: "text-primary",
  mastered: "text-success",
};

/** "3 ngày nữa", "hôm nay", "quá hạn 2 ngày" — cho lịch ôn tiếp theo. */
export function dueLabel(dueAt: string | null, now: Date = new Date()): string {
  if (!dueAt) return "Chưa học";
  const days = Math.round((new Date(dueAt).getTime() - now.getTime()) / 86_400_000);
  if (days > 0) return `Ôn sau ${days} ngày`;
  if (days === 0) return "Ôn hôm nay";
  return `Quá hạn ${-days} ngày`;
}
