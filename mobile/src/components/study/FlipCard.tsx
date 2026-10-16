import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from "react-native-reanimated";

const FLIP_MS = 300;

type FlipCardProps = {
  flipped: boolean;
  front: ReactNode;
  back: ReactNode;
};

/** Thẻ hai mặt, lật bằng rotateY ~300 ms; mặt đang quay lưng bị ẩn (PLAN.md 10.6). */
export function FlipCard({ flipped, front, back }: FlipCardProps) {
  const rotation = useDerivedValue(() => withTiming(flipped ? 180 : 0, { duration: FLIP_MS }));
  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${rotation.value}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1000 }, { rotateY: `${rotation.value + 180}deg` }],
  }));

  return (
    <View className="flex-1">
      <Animated.View
        style={[styles.face, frontStyle]}
        className="rounded-2xl bg-surface"
        accessibilityElementsHidden={flipped}
        importantForAccessibility={flipped ? "no-hide-descendants" : "auto"}
      >
        {front}
      </Animated.View>
      <Animated.View
        style={[styles.face, backStyle]}
        className="rounded-2xl bg-surface"
        accessibilityElementsHidden={!flipped}
        importantForAccessibility={flipped ? "auto" : "no-hide-descendants"}
      >
        {back}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backfaceVisibility: "hidden",
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
