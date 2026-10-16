import { clearTokens, loadTokens, saveTokens } from "./tokenStorage";
import type { TokenPair } from "./types";

// Expo chỉ nhúng biến EXPO_PUBLIC_* khi đọc trực tiếp dạng process.env.TEN_BIEN.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");
const TIMEOUT_MS = 15_000;

/** Lỗi theo định dạng ở PLAN.md 8.1. status = 0 khi không có phản hồi từ server. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type RequestOptions = {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
  /** Gắn access token và tự refresh khi hết hạn. Tắt cho /auth/login, /register, /refresh. */
  auth?: boolean;
  /** Mặc định 15 giây; request gọi AI cần lâu hơn. */
  timeoutMs?: number;
  /** "text": trả nội dung thô (vd. file CSV); lỗi vẫn đọc theo JSON như mọi request. */
  responseType?: "json" | "text";
};

type ErrorBody = { error?: { code?: unknown; message?: unknown; details?: unknown } };

// authStore đăng ký hàm này (tránh import vòng client ↔ store): xoá token, về màn đăng nhập.
let onAuthFailure: () => Promise<void> = async () => {
  await clearTokens();
};

export function setAuthFailureHandler(handler: () => Promise<void>): void {
  onAuthFailure = handler;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toApiError(status: number, body: unknown): ApiError {
  const error = (body as ErrorBody | null)?.error;
  if (error && typeof error.code === "string" && typeof error.message === "string") {
    return new ApiError(status, error.code, error.message, error.details ?? null);
  }
  return new ApiError(status, `HTTP_${status}`, `Máy chủ trả lỗi ${status}`);
}

async function send<T>(path: string, options: RequestOptions, accessToken?: string): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(0, "CONFIG_ERROR", "Chưa đặt EXPO_PUBLIC_API_URL trong mobile/.env");
  }

  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: options.responseType === "text" ? "text/csv, application/json" : "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new ApiError(0, "TIMEOUT", `Máy chủ không phản hồi sau ${timeoutMs / 1000} giây`);
    }
    if (options.signal?.aborted) throw err;
    throw new ApiError(0, "NETWORK", `Không kết nối được tới ${BASE_URL}`);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) throw toApiError(response.status, await parseJson(response));
  if (options.responseType === "text") return (await response.text()) as T;
  return (await parseJson(response)) as T;
}

// Single-flight: các request cùng gặp TOKEN_EXPIRED dùng chung một lần refresh.
let refreshing: Promise<void> | null = null;

async function doRefresh(): Promise<void> {
  const tokens = await loadTokens();
  if (!tokens) {
    await onAuthFailure();
    throw new ApiError(401, "TOKEN_INVALID", "Phiên đăng nhập không hợp lệ");
  }
  try {
    const pair = await send<TokenPair>("/auth/refresh", {
      method: "POST",
      body: { refresh_token: tokens.refresh },
    });
    await saveTokens(pair);
  } catch (err) {
    // Refresh bị từ chối (TOKEN_INVALID, REFRESH_REUSED…) → đăng xuất.
    // Lỗi mạng thì giữ phiên, để mất Wi‑Fi thoáng qua không văng ra màn đăng nhập.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      await onAuthFailure();
    }
    throw err;
  }
}

export function refreshTokens(): Promise<void> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (options.auth === false) return send<T>(path, options);

  if (refreshing) await refreshing.catch(() => undefined); // đợi lần refresh đang chạy
  const tokens = await loadTokens();
  try {
    return await send<T>(path, options, tokens?.access);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    if (err.code === "TOKEN_EXPIRED") {
      await refreshTokens();
      const fresh = await loadTokens();
      try {
        return await send<T>(path, options, fresh?.access); // thử lại đúng một lần
      } catch (retryErr) {
        if (retryErr instanceof ApiError && retryErr.status === 401 && retryErr.code.startsWith("TOKEN_")) {
          await onAuthFailure();
        }
        throw retryErr;
      }
    }
    if (err.code === "TOKEN_INVALID") await onAuthFailure();
    throw err; // 401 khác (vd. INVALID_CREDENTIALS khi đổi mật khẩu) không đăng xuất
  }
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
