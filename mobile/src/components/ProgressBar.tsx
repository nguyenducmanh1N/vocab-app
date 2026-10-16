import { View } from "react-native";

type ProgressBarProps = {
  /** 0..1 */
  value: number;
  accessibilityLabel?: string;
};

export function ProgressBar({ value, accessibilityLabel }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      className="h-2 overflow-hidden rounded-full bg-textMuted/20"
    >
      <View className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
    </View>
  );
}
