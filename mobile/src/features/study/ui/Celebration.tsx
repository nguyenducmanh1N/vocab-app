import LottieView from "lottie-react-native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";

const CONFETTI = require("@/assets/lottie/confetti.json");
const MAX_VISIBLE_MS = 3000; // hoạt ảnh dài 2 giây; gỡ lớp phủ kể cả khi onAnimationFinish không bắn

/**
 * Pháo giấy phủ màn hình khi đạt mục tiêu ngày (PLAN.md 10.6); tự gỡ khi chạy xong.
 * Lớp phủ ẩn với VoiceOver (không che nội dung bên dưới), thay vào đó đọc một thông báo.
 */
export function Celebration() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Đạt mục tiêu hôm nay!");
    const timer = setTimeout(() => setVisible(false), MAX_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      className="items-center"
    >
      <LottieView
        source={CONFETTI}
        autoPlay
        loop={false}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
        onAnimationFinish={() => setVisible(false)}
      />
      <View className="mt-24 rounded-full bg-success px-5 py-2">
        <Text className="text-body font-bold text-white">Đạt mục tiêu hôm nay!</Text>
      </View>
    </View>
  );
}
