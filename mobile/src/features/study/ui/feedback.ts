/** Rung theo kết quả (PLAN.md 10.6); lỗi rung (máy không hỗ trợ) thì bỏ qua. */
import * as Haptics from "expo-haptics";

export function hapticResult(correct: boolean): void {
  Haptics.notificationAsync(
    correct ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => undefined);
}

export function hapticSelect(): void {
  Haptics.selectionAsync().catch(() => undefined);
}
