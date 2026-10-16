import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from "expo-audio";

import { cacheInBackground, cachedUri } from "./audioCache";
import { speak, stopSpeaking } from "./speech";

// Quá thời gian này mà file chưa tải xong thì coi như lỗi, chuyển sang giọng máy.
const LOAD_TIMEOUT_MS = 2000;
// Máy chủ phát âm vừa lỗi thì bỏ qua nó trong khoảng này, đọc ngay bằng giọng máy.
const HOST_COOLDOWN_MS = 60_000;

const failedUrls = new Set<string>(); // file đã lỗi trong lần mở app này
const hostDownUntil = new Map<string, number>();

function hostOf(url: string): string {
  return url.split("/")[2] ?? url;
}

function markFailed(url: string): void {
  failedUrls.add(url);
  hostDownUntil.set(hostOf(url), Date.now() + HOST_COOLDOWN_MS);
}

function shouldSkip(url: string): boolean {
  return failedUrls.has(url) || (hostDownUntil.get(hostOf(url)) ?? 0) > Date.now();
}

let player: AudioPlayer | null = null;
let cleanup: (() => void) | null = null;

/** Gọi một lần lúc khởi động: vẫn nghe được khi iPhone gạt công tắc im lặng (PLAN.md 10.4). */
export async function configureAudio(): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: true });
}

/**
 * Bật/tắt chế độ ghi âm (luyện nói). Chỉ bật trong lúc ghi: khi bật, iOS phát qua loa thoại
 * (rất nhỏ), nên dừng ghi là phải tắt để nghe lại bản ghi và câu mẫu ra loa ngoài.
 */
export async function setRecordingMode(on: boolean): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: on });
}

/** Dừng mọi âm thanh đang phát (file mp3 và giọng máy). */
export function stopAll(): void {
  cleanup?.();
  cleanup = null;
  player?.pause();
  stopSpeaking();
}

/**
 * Phát cách đọc của từ: có audio_url thì phát file mp3, không có hoặc tải lỗi thì đọc bằng giọng máy.
 */
export function playWord(term: string, audioUrl: string | null | undefined): void {
  stopAll();
  if (!audioUrl) {
    speak(term);
    return;
  }
  // Đã lưu trên máy thì phát file cục bộ: nhanh, chạy cả khi offline hoặc máy chủ sập.
  const local = cachedUri(audioUrl);
  if (!local && shouldSkip(audioUrl)) {
    speak(term);
    return;
  }
  if (!local) cacheInBackground(audioUrl); // tải về nền cho lần sau
  const source = local ?? audioUrl;

  player ??= createAudioPlayer(null);
  const current = player;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: { remove: () => void } | undefined;

  const finish = () => {
    clearTimeout(timer);
    subscription?.remove();
  };
  const fallback = () => {
    if (settled) return;
    settled = true;
    markFailed(audioUrl);
    finish();
    current.pause();
    speak(term); // file lỗi hoặc tải quá lâu → giọng máy
  };

  subscription = current.addListener("playbackStatusUpdate", (status: AudioStatus) => {
    if (status.error) fallback();
    else if (status.isLoaded && !settled) {
      settled = true;
      clearTimeout(timer);
      hostDownUntil.delete(hostOf(audioUrl)); // máy chủ đã chạy lại
    }
  });
  timer = setTimeout(fallback, LOAD_TIMEOUT_MS);
  cleanup = finish;

  try {
    current.replace({ uri: source });
    current.seekTo(0).catch(() => undefined);
    current.play();
  } catch {
    fallback();
  }
}

/** Đọc một câu (ví dụ) bằng giọng máy; dừng âm thanh đang phát trước. */
export function speakSentence(text: string): void {
  stopAll();
  speak(text);
}
