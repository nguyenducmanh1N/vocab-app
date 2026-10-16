import { ActivityIndicator, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useTheme } from "@/theme/useTheme";

type Props = {
  attempt: number;
  canSkip: boolean;
  onRetry: () => void;
  onSkip: () => void;
};

/** Màn chờ khi máy chủ (gói free) đang khởi động lại sau thời gian ngủ (PLAN.md 13.2). */
export function ServerWakeScreen({ attempt, canSkip, onRetry, onSkip }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-5 bg-background px-8"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      <View className="items-center gap-2" accessibilityLiveRegion="polite">
        <Text className="text-center text-title font-bold text-text">Đang khởi động máy chủ…</Text>
        <Text className="text-center text-body text-textMuted">
          Máy chủ miễn phí tự nghỉ khi lâu không dùng. Lần mở đầu có thể mất khoảng 1 phút.
        </Text>
        {attempt > 0 ? <Text className="text-caption text-textMuted">Lần thử {attempt + 1}</Text> : null}
      </View>
      <View className="w-full gap-3">
        <Button title="Thử lại ngay" variant="secondary" onPress={onRetry} />
        {canSkip ? (
          <>
            <Button title="Vào app không chờ" variant="ghost" onPress={onSkip} />
            <Text className="text-center text-caption text-textMuted">
              Kiểm tra kết nối mạng. Kết quả học khi chưa có mạng vẫn được lưu và tự gửi sau.
            </Text>
          </>
        ) : null}
      </View>
    </View>
  );
}
