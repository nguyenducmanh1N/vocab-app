import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, type TextInputProps } from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Input } from "./Input";

type PasswordInputProps = TextInputProps & { label?: string; error?: string };

export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const { colors } = useTheme();

  return (
    <Input
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      right={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center"
        >
          <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textMuted} />
        </Pressable>
      }
    />
  );
}
