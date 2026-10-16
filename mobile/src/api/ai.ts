import { withAiConsent } from "@/features/ai/consent";

import { api, request } from "./client";
import { toQuery } from "./query";
import type {
  EnrichOut,
  HistoryItem,
  QuotaOut,
  SpeakingFeedback,
  SpeakingFeedbackIn,
  SuggestIn,
  SuggestOut,
} from "./types";

// Gemini tối đa 20 giây mỗi model, có thể thử thêm model dự phòng (PLAN.md 9.7).
const AI_TIMEOUT_MS = 45_000;

// Mọi /ai/* cần đồng ý (PLAN.md 9.16). Thao tác của người dùng: server báo chưa đồng ý thì
// hỏi lại rồi gọi lại; lệnh chỉ đọc (lượt, lịch sử) thì không tự mở sheet.
const ACTION = { prompt: true };
const READ = { prompt: false };

/** Tự điền bằng AI; mỗi request tính một lượt trong ngày (PLAN.md 9.8). */
export function enrichTerms(terms: string[], level?: string): Promise<EnrichOut> {
  return withAiConsent(
    () =>
      request<EnrichOut>("/ai/enrich", {
        method: "POST",
        body: { terms, ...(level ? { level } : {}) },
        timeoutMs: AI_TIMEOUT_MS,
      }),
    ACTION,
  );
}

/** Gợi ý từ theo chủ đề (PLAN.md 9.7); cùng tham số trong 7 ngày trả từ cache. */
export function suggestWords(body: SuggestIn): Promise<SuggestOut> {
  return withAiConsent(
    () => request<SuggestOut>("/ai/suggest", { method: "POST", body, timeoutMs: AI_TIMEOUT_MS }),
    ACTION,
  );
}

export function getAiHistory(limit = 20, signal?: AbortSignal): Promise<HistoryItem[]> {
  return withAiConsent(() => api.get<HistoryItem[]>(`/ai/history${toQuery({ limit })}`, signal), READ);
}

/** Như response của /ai/suggest; already_saved tính lại, không tốn lượt. */
export function getAiHistoryDetail(id: string): Promise<SuggestOut> {
  return withAiConsent(() => api.get<SuggestOut>(`/ai/history/${id}`), ACTION);
}

export function getAiQuota(signal?: AbortSignal): Promise<QuotaOut> {
  return withAiConsent(() => api.get<QuotaOut>("/ai/quota", signal), READ);
}

/** Lọc từ đáng học trong ảnh (base64 JPEG); tính 1 lượt gợi ý. */
export function extractFromImage(imageBase64: string, level: string, count = 20): Promise<SuggestOut> {
  return withAiConsent(
    () =>
      request<SuggestOut>("/ai/extract", {
        method: "POST",
        body: { image_base64: imageBase64, mime_type: "image/jpeg", level, count },
        timeoutMs: AI_TIMEOUT_MS,
      }),
    ACTION,
  );
}

/** Gemini nghe bản ghi luyện nói (2 lần gọi, PLAN.md 9.11); chỉ lần có chấm mới tính lượt. */
export function speakingFeedback(body: SpeakingFeedbackIn): Promise<SpeakingFeedback> {
  return withAiConsent(
    () =>
      request<SpeakingFeedback>("/ai/speaking-feedback", {
        method: "POST",
        body,
        timeoutMs: AI_TIMEOUT_MS,
      }),
    ACTION,
  );
}
