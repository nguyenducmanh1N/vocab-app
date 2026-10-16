/**
 * Đánh thức máy chủ lúc mở app (PLAN.md 13.2): gói free của Render ngủ khi lâu không có request,
 * lần gọi đầu có thể mất khoảng một phút. Hàm thuần để test bằng jest.
 */
import { ApiError } from "@/api/client";

const DELAYS_MS = [2_000, 4_000, 8_000, 15_000]; // sau đó giữ 15 giây mỗi lần
export const SKIP_AFTER_MS = 90_000; // chờ quá lâu thì cho vào app không chờ
export const HEALTH_TIMEOUT_MS = 10_000;

/** Thời gian chờ trước lần thử thứ `attempt` (1 = sau lần thất bại đầu), dao động ±20%. */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = DELAYS_MS[Math.min(Math.max(attempt, 1), DELAYS_MS.length) - 1];
  const jitter = 1 + (random() * 2 - 1) * 0.2;
  return Math.round(base * jitter);
}

/** Lỗi do máy chủ chưa sẵn sàng (đang khởi động, mất mạng, hết giờ): nên chờ rồi thử lại. */
export function isServerWaking(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === "CONFIG_ERROR") return false; // thiếu EXPO_PUBLIC_API_URL: thử lại vô ích
  return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504;
}
