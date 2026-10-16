import * as Speech from "expo-speech";

import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Đọc bằng giọng máy theo cài đặt voice và speech_rate (PLAN.md 7.3, 10.4).
 * Dừng câu đang đọc trước khi đọc câu mới để các câu không chồng lên nhau.
 * `rate` để đọc chậm (0.5) khi nghe chép hoặc trắc nghiệm nghe.
 */
/** Tốc độ "nghe chậm" (nghe chép, trắc nghiệm nghe, luyện nói). */
export const SLOW_RATE = 0.5;

export function speak(text: string, rate?: number): void {
  const { voice, speech_rate } = useSettingsStore.getState().settings;
  Speech.stop();
  Speech.speak(text, { language: voice, rate: rate ?? speech_rate });
}

export function stopSpeaking(): void {
  Speech.stop();
}
