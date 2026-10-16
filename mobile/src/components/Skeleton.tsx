import { useEffect, useState } from "react";
import { Animated, Text, View } from "react-native";

type SkeletonProps = {
  /** Dòng chữ dưới các thanh, ví dụ "Đang soạn 20 từ về chủ đề…" (PLAN.md 10.6). */
  message?: string;
  rows?: number;
};

/** Các thanh xám nhấp nháy trong lúc chờ AI. */
export function Skeleton({ message, rows = 4 }: SkeletonProps) {
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View className="gap-3" accessibilityRole="progressbar" accessibilityLabel={message}>
      {message ? <Text className="text-body text-textMuted">{message}</Text> : null}
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={{ opacity }} className="gap-2 rounded-2xl bg-surface p-4">
          <View className="h-4 w-1/3 rounded bg-textMuted/20" />
          <View className="h-3 w-2/3 rounded bg-textMuted/20" />
        </Animated.View>
      ))}
    </View>
  );
}
