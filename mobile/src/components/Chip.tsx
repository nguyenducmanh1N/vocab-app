import { Pressable, Text } from "react-native";

type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function Chip({ label, selected, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-[44px] justify-center rounded-full border px-4 ${
        selected ? "border-primary bg-primary" : "border-textMuted/30 bg-surface"
      }`}
    >
      <Text className={`text-caption font-semibold ${selected ? "text-white" : "text-text"}`}>
        {label}
      </Text>
    </Pressable>
  );
}
