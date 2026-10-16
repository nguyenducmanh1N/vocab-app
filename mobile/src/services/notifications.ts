/**
 * Thông báo cục bộ (PLAN.md 10.5): thông báo từ vựng, nhắc học, giữ streak.
 * Trong Expo Go, thông báo hiện dưới tên và icon của Expo Go.
 */
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";

import { getWordFeed } from "@/api/notifications";
import { getStatsOverview } from "@/api/stats";
import { buildSchedule, DAYS_AHEAD } from "@/features/notifications/schedule";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";

/** Gọi một lần lúc khởi động: thông báo vẫn hiện (banner, âm thanh) khi app đang mở. */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export type PermissionState = "granted" | "denied" | "undetermined";

export async function getPermissionState(): Promise<PermissionState> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
}

/** Xin quyền khi chưa hỏi lần nào (sau phiên học đầu tiên, không phải lúc mở app). */
export async function ensurePermission(): Promise<boolean> {
  const state = await getPermissionState();
  if (state !== "undetermined") return state === "granted";
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function rescheduleOnce(): Promise<number> {
  if (!useAuthStore.getState().user) return 0;
  if ((await getPermissionState()) !== "granted") {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return 0;
  }
  const notify = useSettingsStore.getState().settings.notify;
  // Lấy dữ liệu trước khi huỷ lịch cũ: mất mạng thì giữ nguyên lịch đang có.
  const [feed, overview] = await Promise.all([
    notify.word_push && notify.word_push_per_day > 0
      ? getWordFeed(DAYS_AHEAD, notify.word_push_per_day).then((out) => out.items)
      : Promise.resolve([]),
    getStatsOverview(),
  ]);
  const plan = buildSchedule({
    now: new Date(),
    notify,
    feed,
    dueToday: overview.due_today,
    cardsToday: overview.today.cards_done,
  });

  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const item of plan) {
    await Notifications.scheduleNotificationAsync({
      content: { title: item.title, body: item.body, data: item.data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: item.date },
    });
  }
  return plan.length;
}

// Chỉ một lần làm lịch tại một thời điểm; gọi chồng thì chạy thêm một lượt sau khi xong.
let running: Promise<number> | null = null;
let again = false;

/**
 * Làm lại toàn bộ lịch (10.5): khi app vào foreground, sau mỗi phiên học, khi đổi cài đặt
 * thông báo. Trả số thông báo đã đặt; lỗi mạng thì giữ lịch cũ.
 */
export function rescheduleAll(): Promise<number> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let count = 0;
    do {
      again = false;
      count = await rescheduleOnce();
    } while (again);
    return count;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function cancelAllNotifications(): Promise<void> {
  return Notifications.cancelAllScheduledNotificationsAsync();
}

export async function scheduledCount(): Promise<number> {
  return (await Notifications.getAllScheduledNotificationsAsync()).length;
}

/** Bấm vào thông báo (kể cả khi app đang tắt) → mở đường dẫn trong data.url, vd. /word/<id>. */
export function useNotificationRouting(enabled: boolean): void {
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !response) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const url = response.notification.request.content.data?.url;
    if (typeof url === "string" && url.startsWith("/")) router.push(url as never);
  }, [enabled, response]);
}
