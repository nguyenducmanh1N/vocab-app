import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

import { useTheme } from "@/theme/useTheme";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = Omit<PressableProps, "children"> & {
  title: string;
  variant?: Variant;
  loading?: boolean;
};

const containerClass: Record<Variant, string> = {
  primary: "bg-primary",
  secondary: "bg-surface border border-primary",
  danger: "bg-danger",
  ghost: "bg-transparent",
};

const labelClass: Record<Variant, string> = {
  primary: "text-white",
  secondary: "text-primary",
  danger: "text-white",
  ghost: "text-primary",
};

export function Button({
  title,
  variant = "primary",
  loading = false,
  disabled,
  ...rest
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  const spinnerColor = variant === "primary" || variant === "danger" ? "#FFFFFF" : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      // Khi đang tải, chữ bị thay bằng vòng quay: vẫn cần tên để VoiceOver đọc.
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={`min-h-[44px] flex-row items-center justify-center rounded-xl px-4 active:opacity-80 ${
        containerClass[variant]
      } ${isDisabled ? "opacity-50" : ""}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <Text className={`text-body font-semibold ${labelClass[variant]}`}>{title}</Text>
      )}
    </Pressable>
  );
}
