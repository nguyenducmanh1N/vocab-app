/**
 * Đồng ý gửi nội dung cho Google Gemini (PLAN.md 9.16, 10.1). Trạng thái lấy từ user
 * (`ai_consent_at`); server mới là nơi quyết định, nên gặp 403 AI_CONSENT_REQUIRED (vd. đổi
 * AI_CONSENT_VERSION) thì coi như chưa đồng ý và hỏi lại.
 */
import { router } from "expo-router";

import { ApiError } from "@/api/client";
import { setAiConsent } from "@/api/me";
import { queryClient } from "@/api/queryClient";
import { useAuthStore } from "@/stores/authStore";

const AI_QUERY_KEYS = ["ai-quota", "ai-history"];

let pending: Promise<boolean> | null = null;
let settle: ((agreed: boolean) => void) | null = null;

/** Chưa tải được user (mất mạng lúc mở app) thì coi là có: để server quyết định. */
export function hasAiConsent(): boolean {
  const user = useAuthStore.getState().user;
  return user === null || user.ai_consent_at !== null;
}

/** Nhãn nút AI khi chưa đồng ý: bấm vào thì mở sheet, không báo lỗi. */
export function aiButtonTitle(title: string, granted: boolean): string {
  return granted ? title : `${title} · Cần đồng ý`;
}

/** Hook cho nút AI: `granted` = false thì nút hiện "Cần đồng ý". */
export function useAiConsent() {
  const granted = useAuthStore((s) => s.user === null || s.user.ai_consent_at !== null);
  return { granted, ensure: ensureAiConsent };
}

/** Mở sheet đồng ý; true nếu người dùng bấm Đồng ý (đã lưu lên server). Gọi chồng thì dùng chung. */
export function requestAiConsent(): Promise<boolean> {
  if (pending) return pending;
  pending = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  router.push("/ai/consent");
  return pending;
}

/** Sheet gọi khi đóng: Đồng ý, Không, hoặc vuốt đóng (= Không). */
export function settleAiConsent(agreed: boolean): void {
  settle?.(agreed);
  settle = null;
  pending = null;
}

/** Trước mỗi thao tác AI: đã đồng ý thì đi tiếp, chưa thì hỏi. */
export async function ensureAiConsent(): Promise<boolean> {
  return hasAiConsent() || requestAiConsent();
}

function updateUserConsent(consent: { ai_consent_at: string | null; ai_consent_version: number | null }) {
  const { user, setUser } = useAuthStore.getState();
  if (user) setUser({ ...user, ...consent });
}

export async function acceptAiConsent(): Promise<void> {
  updateUserConsent(await setAiConsent(true));
  await Promise.all(AI_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

export async function withdrawAiConsent(): Promise<void> {
  updateUserConsent(await setAiConsent(false));
  AI_QUERY_KEYS.forEach((key) => queryClient.removeQueries({ queryKey: [key] }));
}

export function isAiConsentError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "AI_CONSENT_REQUIRED";
}

/**
 * Bọc một lệnh gọi /ai/*. Server báo chưa đồng ý → ghi nhận ở store (nút chuyển sang
 * "Cần đồng ý"); `prompt` = true thì mở sheet và gọi lại một lần nếu người dùng đồng ý.
 */
export async function withAiConsent<T>(call: () => Promise<T>, { prompt }: { prompt: boolean }): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!isAiConsentError(err)) throw err;
    updateUserConsent({ ai_consent_at: null, ai_consent_version: null });
    if (!prompt || !(await requestAiConsent())) throw err;
    return call();
  }
}
