import { api, request } from "./client";
import type { AiConsentOut, NotifySettings, UserOut, UserSettings } from "./types";

export function getMe(): Promise<UserOut> {
  return api.get<UserOut>("/me");
}

export type MePatch = {
  display_name?: string;
  level?: string;
  timezone?: string;
  /** Gộp một phần vào settings đang lưu (PLAN.md 7.3), kể cả nhóm notify. */
  settings?: Partial<Omit<UserSettings, "notify">> & { notify?: Partial<NotifySettings> };
};

export function patchMe(body: MePatch): Promise<UserOut> {
  return api.patch<UserOut>("/me", body);
}

/** Đồng ý (true) hoặc rút lại đồng ý (false) gửi nội dung cho Google Gemini (PLAN.md 9.16). */
export function setAiConsent(accepted: boolean): Promise<AiConsentOut> {
  return api.post<AiConsentOut>("/me/ai-consent", { accepted });
}

/** CSV mọi từ của user, theo tên list (sao lưu, vd. trước khi xoá tài khoản). */
export function exportAllCsv(): Promise<string> {
  return request<string>("/me/export", { responseType: "text" });
}

/** Xoá tài khoản và mọi dữ liệu; sai mật khẩu → 401 INVALID_CREDENTIALS (không đăng xuất). */
export function deleteAccount(password: string): Promise<void> {
  return request<void>("/me/delete", { method: "POST", body: { password } });
}
