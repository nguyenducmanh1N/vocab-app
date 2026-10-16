import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./client";

/** Lỗi 4xx (dữ liệu sai, không có quyền…) thử lại cũng vô ích; lỗi mạng và 5xx thử lại 1 lần. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

// Dùng chung cho cả app; authStore xoá cache khi đăng xuất (PLAN.md 10.2).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: shouldRetry },
    mutations: { retry: false },
  },
});
