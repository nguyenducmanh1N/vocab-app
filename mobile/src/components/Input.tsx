import type { ReactNode } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "@/theme/useTheme";

type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  /** Phần tử gắn bên phải ô nhập, ví dụ nút hiện/ẩn mật khẩu. */
  right?: ReactNode;
};

export function Input({ label, error, right, ...rest }: InputProps) {
  const { colors } = useTheme();

  return (
    <View className="gap-1">
      {label ? <Text className="text-caption text-textMuted">{label}</Text> : null}
      <View
        className={`min-h-[44px] flex-row rounded-xl border bg-surface ${
          rest.multiline ? "items-start" : "items-center"
        } ${error ? "border-danger" : "border-textMuted/30"}`}
      >
        <TextInput
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          textAlignVertical={rest.multiline ? "top" : "center"}
          // Chỉ đặt cỡ chữ 17 (không dùng text-body vì kèm lineHeight): TextInput trên iOS
          // có lineHeight sẽ đẩy chữ lệch khỏi giữa ô.
          className={`min-h-[44px] flex-1 px-3 text-[17px] text-text ${
            rest.multiline ? "py-3" : "py-0"
          }`}
          {...rest}
        />
        {right}
      </View>
      {error ? <Text className="text-caption text-danger">{error}</Text> : null}
    </View>
  );
}
