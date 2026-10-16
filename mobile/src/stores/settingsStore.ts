import { create } from "zustand";

import type { UserSettings } from "@/api/types";

// Mặc định theo PLAN.md 7.3; dùng khi chưa tải được hồ sơ (vd. mở app lúc mất mạng).
export const DEFAULT_SETTINGS: UserSettings = {
  daily_new_words: 10,
  max_reviews_per_day: 100,
  daily_goal_cards: 20,
  card_direction: "en_vi",
  voice: "en-US",
  speech_rate: 0.9,
  auto_play_audio: true,
  theme: "system",
  notify: {
    daily_reminder: true,
    reminder_time: "20:00",
    word_push: true,
    word_push_per_day: 3,
    window_start: "08:00",
    window_end: "22:00",
    streak_guard: true,
  },
};

type SettingsState = {
  settings: UserSettings;
  /** Đặt từ user.settings do server trả (authStore gọi khi đăng nhập hoặc mở app). */
  setSettings: (settings: UserSettings) => void;
  reset: () => void;
};

/**
 * Bản sao user.settings để giao diện dùng ngay (PLAN.md 10.2). Đồng bộ lên server bằng
 * PATCH /me (debounce 500 ms) sẽ thêm cùng màn Cài đặt.
 */
export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: DEFAULT_SETTINGS,
  setSettings: (settings) => set({ settings }),
  reset: () => set({ settings: DEFAULT_SETTINGS }),
}));
