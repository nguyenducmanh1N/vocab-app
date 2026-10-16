import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { StudyMode } from "@/api/types";
import { useTheme } from "@/theme/useTheme";

type ModeOption = {
  mode: StudyMode;
  title: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>["name"];
};

export const STUDY_MODE_OPTIONS: readonly ModeOption[] = [
  {
    mode: "learn",
    title: "Học thông minh",
    description: "Trắc nghiệm rồi gõ lại, tới khi thuộc từng từ",
    icon: "sparkles-outline",
  },
  {
    mode: "flashcard",
    title: "Flashcard",
    description: "Lật thẻ, vuốt phải nếu nhớ, vuốt trái nếu chưa",
    icon: "albums-outline",
  },
  {
    mode: "mcq",
    title: "Trắc nghiệm",
    description: "Chọn 1 trong 4 đáp án, có câu nghe",
    icon: "list-outline",
  },
  {
    mode: "typing",
    title: "Gõ từ",
    description: "Xem nghĩa, gõ lại từ tiếng Anh",
    icon: "create-outline",
  },
  {
    mode: "dictation",
    title: "Nghe chép",
    description: "Nghe phát âm, gõ lại từ",
    icon: "headset-outline",
  },
  {
    mode: "cloze",
    title: "Điền chỗ trống",
    description: "Điền từ còn thiếu vào câu ví dụ",
    icon: "document-text-outline",
  },
  {
    mode: "match",
    title: "Ghép cặp",
    description: "Nối 6 cặp từ–nghĩa, đua với kỷ lục",
    icon: "grid-outline",
  },
  {
    mode: "test",
    title: "Kiểm tra",
    description: "20 câu trộn, chấm điểm cuối bài",
    icon: "clipboard-outline",
  },
  {
    mode: "speaking",
    title: "Luyện nói",
    description: "Nghe câu mẫu, ghi âm rồi tự chấm",
    icon: "mic-outline",
  },
];

type Props = {
  onClose: () => void;
  onSelect: (mode: StudyMode) => void;
};

/**
 * Nội dung popup chọn cách học (nền mờ + khung trượt từ dưới); chạm nền mờ để đóng.
 * Hiển thị qua route `study/choose` (transparentModal của navigator), không dùng Modal của
 * React Native: Modal RN đóng rồi mở ngay màn học (modal của react-native-screens) làm hỏng
 * cây trợ năng của các màn mở sau đó trên iOS (VoiceOver không đọc được).
 */
export function StudyModeSheet({ onClose, onSelect }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Đóng"
        onPress={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <View
        className="max-h-[85%] gap-3 rounded-t-3xl bg-background px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <View className="h-1 w-10 self-center rounded-full bg-textMuted/30" />
        <View className="flex-row items-center justify-between">
          <Text className="text-[20px] font-bold text-text">Chọn cách học</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Đóng"
            onPress={onClose}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
        {/* 9 chế độ cao hơn màn hình: danh sách cuộn, tiêu đề luôn hiện. */}
        <ScrollView contentContainerClassName="gap-3" showsVerticalScrollIndicator={false}>
          {STUDY_MODE_OPTIONS.map((option) => (
            <Pressable
              key={option.mode}
              accessibilityRole="button"
              // Nhãn rõ ràng: không để VoiceOver đọc ký tự của icon (font Ionicons).
              accessibilityLabel={option.title}
              accessibilityHint={option.description}
              onPress={() => onSelect(option.mode)}
              className="min-h-[72px] flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3 active:opacity-70"
            >
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                <Ionicons name={option.icon} size={24} color={colors.primary} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="text-body font-semibold text-text">{option.title}</Text>
                <Text className="text-caption text-textMuted">{option.description}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
