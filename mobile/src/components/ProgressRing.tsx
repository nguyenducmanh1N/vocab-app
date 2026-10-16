import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useTheme } from "@/theme/useTheme";

type ProgressRingProps = {
  /** 0..1 (lớn hơn 1 vẫn vẽ đủ vòng) */
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: ReactNode; // nội dung ở giữa vòng
  accessibilityLabel?: string;
};

/** Vòng tiến độ (PLAN.md 10.6), vẽ bằng react-native-svg; bắt đầu từ đỉnh, đi theo chiều kim đồng hồ. */
export function ProgressRing({
  value,
  size = 112,
  strokeWidth = 10,
  color,
  children,
  accessibilityLabel,
}: ProgressRingProps) {
  const { colors } = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, value));
  const center = size / 2;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{ width: size, height: size }}
      className="items-center justify-center"
    >
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.textMuted}
          strokeOpacity={0.2}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color ?? colors.primary}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          fill="none"
        />
      </Svg>
      {children}
    </View>
  );
}
