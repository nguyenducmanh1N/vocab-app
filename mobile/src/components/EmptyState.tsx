import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

import { Button } from "./Button";

type EmptyStateProps = {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  description?: string;
  /** Luôn có nút hành động (PLAN.md 10.6). */
  actionLabel: string;
  onAction: () => void;
};

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View className="items-center gap-3 px-6 py-12">
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text className="text-center text-body font-semibold text-text">{title}</Text>
      {description ? (
        <Text className="text-center text-caption text-textMuted">{description}</Text>
      ) : null}
      <View className="mt-2 self-stretch">
        <Button title={actionLabel} onPress={onAction} />
      </View>
    </View>
  );
}
