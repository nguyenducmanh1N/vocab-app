import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

type StepperProps = {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Nhãn cho VoiceOver, vd. "Mục tiêu mỗi ngày". */
  accessibilityLabel: string;
  unit?: string;
};

/** Nút − giá trị +, có giới hạn; VoiceOver vuốt lên/xuống để tăng/giảm. */
export function Stepper({ value, onChange, min, max, step = 1, accessibilityLabel, unit }: StepperProps) {
  const { colors } = useTheme();
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const dec = () => onChange(clamp(value - step));
  const inc = () => onChange(clamp(value + step));

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value, text: unit ? `${value} ${unit}` : String(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => (event.nativeEvent.actionName === "increment" ? inc() : dec())}
      className="flex-row items-center gap-1"
    >
      <Pressable
        onPress={dec}
        disabled={value <= min}
        hitSlop={6}
        className={`h-9 w-9 items-center justify-center rounded-full bg-background ${value <= min ? "opacity-40" : "active:opacity-60"}`}
      >
        <Ionicons name="remove" size={20} color={colors.primary} />
      </Pressable>
      <Text className="min-w-[44px] text-center text-body font-semibold text-text">{value}</Text>
      <Pressable
        onPress={inc}
        disabled={value >= max}
        hitSlop={6}
        className={`h-9 w-9 items-center justify-center rounded-full bg-background ${value >= max ? "opacity-40" : "active:opacity-60"}`}
      >
        <Ionicons name="add" size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}
