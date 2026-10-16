import { ApiError } from "@/api/client";
import { messageFor } from "@/api/errorMessages";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "08:00 ngày 16/10" theo giờ của máy. */
export function formatResetsAt(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** Câu lỗi dễ hiểu cho các tính năng AI; 429 kèm giờ được dùng lại. */
export function aiErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === "AI_QUOTA_EXCEEDED") {
    const resetsAt = (error.details as { resets_at?: string } | null)?.resets_at;
    return resetsAt
      ? `Bạn đã dùng hết lượt AI hôm nay. Dùng lại từ ${formatResetsAt(resetsAt)}.`
      : messageFor(error);
  }
  return messageFor(error);
}

/** Lỗi có nên cho bấm "Thử lại" không (502, mạng, hết thời gian chờ). */
export function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}
