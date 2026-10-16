/**
 * Đồng bộ cài đặt lên server (PLAN.md 10.2): gộp các thay đổi liên tiếp, gửi PATCH /me sau
 * 500 ms không đổi gì thêm. Hàm thuần (send, hẹn giờ tiêm vào) để test bằng jest.
 */
import type { NotifySettings, UserSettings } from "@/api/types";

export type SettingsPatch = Partial<Omit<UserSettings, "notify">> & {
  notify?: Partial<NotifySettings>;
};

export const SYNC_DELAY_MS = 500;

/** Gộp hai patch; nhóm notify gộp sâu (đổi giờ nhắc không làm mất khung giờ vừa đổi). */
export function mergePatch(base: SettingsPatch, next: SettingsPatch): SettingsPatch {
  const merged: SettingsPatch = { ...base, ...next };
  if (base.notify || next.notify) merged.notify = { ...base.notify, ...next.notify };
  return merged;
}

/** Áp patch lên settings đầy đủ. */
export function applyPatch(settings: UserSettings, patch: SettingsPatch): UserSettings {
  return { ...settings, ...patch, notify: { ...settings.notify, ...patch.notify } };
}

export function createSettingsSync<Result>(options: {
  send: (patch: SettingsPatch) => Promise<Result>;
  delayMs?: number;
  /** `hasPending`: còn thay đổi chờ gửi (đừng ghi đè giá trị local bằng kết quả này). */
  onSaved?: (result: Result, hasPending: boolean) => void;
  onError?: (error: unknown) => void;
}) {
  const delayMs = options.delayMs ?? SYNC_DELAY_MS;
  let pending: SettingsPatch | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sending: Promise<void> | null = null;

  async function sendPending(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (sending) {
      await sending; // gửi lần lượt; phần đổi thêm sẽ được gửi ở lượt sau
      if (pending) return sendPending();
      return;
    }
    const patch = pending;
    if (!patch) return;
    pending = null;
    sending = (async () => {
      try {
        const result = await options.send(patch);
        options.onSaved?.(result, pending !== null);
      } catch (error) {
        options.onError?.(error);
      }
    })();
    try {
      await sending;
    } finally {
      sending = null;
    }
    if (pending && !timer) timer = setTimeout(() => void sendPending(), delayMs);
  }

  return {
    /** Ghi nhận thay đổi; gửi sau `delayMs` nếu không đổi gì thêm. */
    update(patch: SettingsPatch): void {
      pending = mergePatch(pending ?? {}, patch);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void sendPending(), delayMs);
    },
    /** Gửi ngay phần đang chờ (vd. khi rời màn Cài đặt). */
    flush(): Promise<void> {
      return sendPending();
    },
    hasPending(): boolean {
      return pending !== null || sending !== null;
    },
  };
}
