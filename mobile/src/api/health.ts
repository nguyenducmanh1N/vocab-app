import { api, request } from "./client";
import type { HealthOut } from "./types";

export function getHealth(signal?: AbortSignal): Promise<HealthOut> {
  return api.get<HealthOut>("/health", signal);
}

/** Gọi health không cần token, timeout ngắn: dùng để đánh thức máy chủ lúc mở app. */
export function pingHealth(timeoutMs: number): Promise<HealthOut> {
  return request<HealthOut>("/health", { auth: false, timeoutMs });
}
