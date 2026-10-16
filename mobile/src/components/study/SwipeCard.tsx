import type { ReactNode } from "react";
import { Text, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

export const SWIPE_THRESHOLD = 120; // px: kéo quá mức này mới tính là vuốt
const MAX_TILT_DEG = 10;

export type SwipeDirection = "left" | "right";

type SwipeCardProps = {
  children: ReactNode;
  onSwipe: (direction: SwipeDirection) => void;
  onTap?: () => void;
  enabled?: boolean;
};

/**
 * Vuốt phải: nhớ, vuốt trái: chưa nhớ (PLAN.md 10.6). Thẻ nghiêng tối đa ±10°.
 * Đặt `key` theo câu hỏi để thẻ mới bắt đầu lại ở giữa.
 */
export function SwipeCard({ children, onSwipe, onTap, enabled = true }: SwipeCardProps) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .onUpdate((event) => {
      x.value = event.translationX;
      y.value = event.translationY * 0.3;
    })
    .onEnd((event) => {
      if (Math.abs(event.translationX) > SWIPE_THRESHOLD) {
        const direction: SwipeDirection = event.translationX > 0 ? "right" : "left";
        x.value = withTiming(Math.sign(event.translationX) * width * 1.5, { duration: 200 }, () => {
          scheduleOnRN(onSwipe, direction);
        });
      } else {
        x.value = withSpring(0);
        y.value = withSpring(0);
      }
    });
  const tap = Gesture.Tap()
    .enabled(enabled && !!onTap)
    .onEnd(() => {
      if (onTap) scheduleOnRN(onTap);
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      {
        rotate: `${interpolate(x.value, [-width, width], [-MAX_TILT_DEG, MAX_TILT_DEG], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));
  const rightLabel = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const leftLabel = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View style={cardStyle} className="flex-1">
        {children}
        <Animated.View
          pointerEvents="none"
          style={leftLabel}
          className="absolute left-4 top-4 rounded-xl border-2 border-danger px-3 py-1"
        >
          <Text className="text-body font-bold text-danger">Chưa nhớ</Text>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={rightLabel}
          className="absolute right-4 top-4 rounded-xl border-2 border-success px-3 py-1"
        >
          <Text className="text-body font-bold text-success">Nhớ</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
