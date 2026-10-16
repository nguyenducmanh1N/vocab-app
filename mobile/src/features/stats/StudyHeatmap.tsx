import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { Card } from "@/components/Card";
import { hapticSelect } from "@/features/study/ui/feedback";
import { useStatsDaily } from "@/hooks/useStats";
import type { ThemeColors } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

import {
  buildHeatmap,
  formatHeatDate,
  HEATMAP_DAYS,
  HEATMAP_WEEKS,
  monthLabels,
  type HeatLevel,
} from "./heatmap";

const GAP = 3;
const LABEL_WIDTH = 24; // cột nhãn thứ bên trái
const HEADER_HEIGHT = 16; // hàng nhãn tháng bên trên
const WEEKDAY_LABELS: [number, string][] = [
  [0, "T2"],
  [2, "T4"],
  [4, "T6"],
  [6, "CN"],
];
const LEVELS: HeatLevel[] = [0, 1, 2, 3, 4];

/** Màu ô theo bậc: ô trống dùng textMuted nhạt, bốn bậc là success đậm dần. */
function levelFill(level: HeatLevel, colors: ThemeColors): { color: string; opacity: number } {
  if (level === 0) return { color: colors.textMuted, opacity: 0.15 };
  return { color: colors.success, opacity: [0.3, 0.55, 0.8, 1][level - 1] };
}

/** Lịch nhiệt 12 tuần (PLAN.md P6.1): mỗi ô là một ngày, chạm để xem số thẻ. */
export function StudyHeatmap({ goal }: { goal: number }) {
  const { colors } = useTheme();
  const { data, isPending, isError } = useStatsDaily(HEATMAP_DAYS);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const cells = data ? buildHeatmap(data, goal) : [];
  const total = cells.reduce((sum, cell) => sum + cell.cardsDone, 0);
  const activeDays = cells.filter((cell) => cell.cardsDone > 0).length;
  const selectedCell = cells.find((cell) => cell.date === selected);

  const size = width > 0 ? Math.floor((width - LABEL_WIDTH - GAP * (HEATMAP_WEEKS - 1)) / HEATMAP_WEEKS) : 0;
  const pitch = size + GAP;
  const svgWidth = LABEL_WIDTH + HEATMAP_WEEKS * pitch - GAP;
  const svgHeight = HEADER_HEIGHT + 7 * pitch - GAP;

  /** Ô dưới ngón tay (toạ độ trong lưới); khe giữa các ô thuộc về ô gần nhất. */
  const cellAt = (x: number, y: number) => {
    const week = Math.min(HEATMAP_WEEKS - 1, Math.max(0, Math.floor((x - LABEL_WIDTH + GAP / 2) / pitch)));
    const weekday = Math.min(6, Math.max(0, Math.floor((y - HEADER_HEIGHT + GAP / 2) / pitch)));
    return cells.find((cell) => cell.week === week && cell.weekday === weekday);
  };
  // Ô chỉ khoảng 22 pt (12 cột): chạm rồi trượt ngón tay trên lưới để chọn, thay cho chạm trúng ô.
  const pick = (x: number, y: number) => {
    const cell = cellAt(x, y);
    if (cell && cell.date !== selected) {
      hapticSelect();
      setSelected(cell.date);
    }
  };
  // VoiceOver: vuốt lên/xuống để sang ngày sau/trước, bắt đầu từ hôm nay.
  const step = (delta: number) => {
    if (!cells.length) return;
    const index = selected ? cells.findIndex((cell) => cell.date === selected) : cells.length;
    const next = cells[Math.min(cells.length - 1, Math.max(0, index + delta))];
    setSelected(next.date);
  };
  const describe = (cell: (typeof cells)[number] | undefined) =>
    cell
      ? `${formatHeatDate(cell.date)}: ${cell.cardsDone > 0 ? `${cell.cardsDone} thẻ` : "không học"}`
      : "Vuốt lên hoặc xuống để chọn ngày";

  let body;
  if (isPending) {
    body = <ActivityIndicator className="py-8" />;
  } else if (isError) {
    body = <Text className="py-6 text-center text-body text-textMuted">Không tải được lịch học.</Text>;
  } else {
    body = (
      <>
        <Text className="text-body text-text">
          {total} thẻ · {activeDays} ngày có học
        </Text>
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Lịch học 12 tuần: tổng ${total} thẻ, ${activeDays} ngày có học`}
          accessibilityValue={{ text: describe(selectedCell) }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => step(event.nativeEvent.actionName === "increment" ? 1 : -1)}
          onStartShouldSetResponder={() => true}
          onResponderGrant={(event) => pick(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderMove={(event) => pick(event.nativeEvent.locationX, event.nativeEvent.locationY)}
        >
          {size > 0 && (
            // pointerEvents none: chạm luôn rơi vào View cha, toạ độ locationX/Y tính theo lưới.
            <Svg width={svgWidth} height={svgHeight} pointerEvents="none">
              {monthLabels(cells).map(({ week, label }) => (
                <SvgText
                  key={`m${week}`}
                  x={LABEL_WIDTH + week * pitch}
                  y={11}
                  fontSize={11}
                  fill={colors.textMuted}
                >
                  {label}
                </SvgText>
              ))}
              {WEEKDAY_LABELS.map(([row, label]) => (
                <SvgText
                  key={label}
                  x={0}
                  y={HEADER_HEIGHT + row * pitch + size / 2 + 4}
                  fontSize={10}
                  fill={colors.textMuted}
                >
                  {label}
                </SvgText>
              ))}
              {cells.map((cell) => {
                const fill = levelFill(cell.level, colors);
                const isSelected = cell.date === selected;
                return (
                  <Rect
                    key={cell.date}
                    x={LABEL_WIDTH + cell.week * pitch}
                    y={HEADER_HEIGHT + cell.weekday * pitch}
                    width={size}
                    height={size}
                    rx={4}
                    fill={fill.color}
                    fillOpacity={fill.opacity}
                    stroke={isSelected ? colors.text : undefined}
                    strokeWidth={isSelected ? 2 : 0}
                  />
                );
              })}
            </Svg>
          )}
        </View>
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-body text-text">
            {selectedCell ? (
              <>
                <Text className="font-semibold">{formatHeatDate(selectedCell.date)}</Text>
                {selectedCell.cardsDone > 0 ? `: ${selectedCell.cardsDone} thẻ` : ": không học"}
              </>
            ) : (
              <Text className="text-caption text-textMuted">Chạm hoặc trượt trên lưới để xem số thẻ.</Text>
            )}
          </Text>
          <View className="flex-row items-center gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text className="text-caption text-textMuted">Ít</Text>
            {LEVELS.map((level) => {
              const fill = levelFill(level, colors);
              return (
                <View
                  key={level}
                  style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: fill.color, opacity: fill.opacity }}
                />
              );
            })}
            <Text className="text-caption text-textMuted">Nhiều</Text>
          </View>
        </View>
        <Text className="text-caption text-textMuted">
          Màu đậm dần theo mục tiêu {goal} thẻ/ngày: dưới một nửa, gần đạt, đạt, gấp đôi.
        </Text>
      </>
    );
  }

  return (
    <Card className="gap-2">
      <Text className="pb-1 text-caption font-semibold uppercase text-textMuted">12 tuần gần đây</Text>
      {body}
    </Card>
  );
}
