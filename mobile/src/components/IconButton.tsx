import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Pressable, type PressableProps } from "react-native";

import { useTheme } from "@/theme/useTheme";

type IconButtonProps = Omit<PressableProps, "children"> & {
  icon: ComponentProps<typeof Ionicons>["name"];
  /** Bắt buộc: nút chỉ có icon phải có nhãn cho VoiceOver (PLAN.md 6.2). */
  accessibilityLabel: string;
  tone?: "primary" | "muted" | "danger" | "warning";
  size?: number;
};

export function IconButton({ icon, tone = "primary", size = 24, ...rest }: IconButtonProps) {
  const { colors } = useTheme();
  const color = {
    primary: colors.primary,
    muted: colors.textMuted,
    danger: colors.danger,
    warning: colors.warning,
  }[tone];

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
      {...rest}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}
