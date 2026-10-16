import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { messageFor } from "@/api/errorMessages";
import { Button } from "@/components/Button";
import { useTheme } from "@/theme/useTheme";

import { acceptAiConsent } from "./consent";

type Item = { icon: ComponentProps<typeof Ionicons>["name"]; text: string };

// Đổi nội dung gửi đi ở đây thì tăng AI_CONSENT_VERSION ở backend để người dùng được hỏi lại.
const SENT: readonly Item[] = [
  { icon: "pricetag-outline", text: "Chủ đề bạn nhập khi nhờ AI gợi ý từ." },
  { icon: "text-outline", text: "Các từ bạn nhờ Tự điền hoặc Nhập nhanh, kèm trình độ bạn chọn." },
  { icon: "image-outline", text: "Văn bản và ảnh bạn chọn để lọc từ (ví dụ ảnh chụp trang sách)." },
  {
    icon: "mic-outline",
    text: "Bản ghi luyện nói: chỉ gửi khi bạn bấm AI nhận xét và đồng ý thêm một lần ở đó.",
  },
];

const PURPOSE =
  "Để gợi ý từ theo chủ đề, viết nghĩa tiếng Việt và câu ví dụ, lọc từ đáng học, và nhận xét phát âm của bạn.";

const NOT_SENT =
  "Không gửi email, mật khẩu hay tên của bạn. Ảnh và bản ghi không được lưu trên máy chủ; chủ đề và kết quả gợi ý được lưu để bạn xem lại trong Lịch sử.";

const FREE_TIER =
  "App dùng gói miễn phí của Gemini: Google có thể dùng nội dung gửi lên để cải thiện sản phẩm của họ. Đừng gửi thông tin riêng tư.";

type Props = {
  /** Gọi sau khi đã lưu đồng ý (true) hoặc khi người dùng chọn Không (false). */
  onDone: (agreed: boolean) => void;
};

/**
 * Màn đồng ý dùng AI (PLAN.md 10.1): nền mờ + khung trượt từ dưới, hiện qua route `ai/consent`
 * (transparentModal, như popup chọn cách học; không dùng Modal của React Native).
 */
export function AiConsentSheet({ onDone }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agree = async () => {
    setSaving(true);
    setError(null);
    try {
      await acceptAiConsent();
      onDone(true);
    } catch (err) {
      setError(messageFor(err));
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Không đồng ý và đóng"
        onPress={() => onDone(false)}
        disabled={saving}
        className="absolute inset-0 bg-black/40"
      />
      <View
        className="max-h-[90%] gap-3 rounded-t-3xl bg-background px-4 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <View className="h-1 w-10 self-center rounded-full bg-textMuted/30" />
        <Text accessibilityRole="header" className="text-[20px] font-bold text-text">
          Dùng AI (Google Gemini)?
        </Text>
        <ScrollView contentContainerClassName="gap-3 pb-1" showsVerticalScrollIndicator={false}>
          <Text className="text-body text-text">
            Các tính năng AI gửi nội dung bạn chọn qua máy chủ của app tới Google Gemini:
          </Text>
          {SENT.map((item) => (
            <View key={item.icon} className="flex-row gap-3">
              <Ionicons name={item.icon} size={20} color={colors.primary} accessible={false} />
              <Text className="flex-1 text-body text-text">{item.text}</Text>
            </View>
          ))}
          <Text className="text-body text-text">{PURPOSE}</Text>
          <Text className="text-caption text-textMuted">{NOT_SENT}</Text>
          <Text className="text-caption text-textMuted">{FREE_TIER}</Text>
          <Text className="text-caption text-textMuted">
            Chọn Không thì các tính năng khác (thư viện từ, học, ôn tập, từ điển) vẫn dùng bình thường.
            Bạn có thể rút lại đồng ý bất cứ lúc nào trong Cài đặt.
          </Text>
        </ScrollView>
        {error ? <Text className="text-body text-danger">{error}</Text> : null}
        <Button title="Đồng ý" onPress={agree} loading={saving} />
        <Button title="Không" variant="ghost" onPress={() => onDone(false)} disabled={saving} />
      </View>
    </View>
  );
}
