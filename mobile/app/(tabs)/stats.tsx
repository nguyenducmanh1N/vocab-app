import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { BarChart } from "react-native-gifted-charts";

import { messageFor } from "@/api/errorMessages";
import type { DailyStat, Level, StatsOverview, StudyMode } from "@/api/types";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ProgressBar } from "@/components/ProgressBar";
import { Screen } from "@/components/Screen";
import { LEVEL_LABELS, LEVEL_TEXT_CLASS } from "@/features/library/labels";
import { StudyHeatmap } from "@/features/stats/StudyHeatmap";
import { formatDuration } from "@/features/study/summary";
import { useHardWords, useStatsDaily, useStatsOverview } from "@/hooks/useStats";
import { useTheme } from "@/theme/useTheme";

const LEVELS: Level[] = ["new", "learning", "familiar", "mastered"];

const MODE_LABELS: Record<StudyMode, string> = {
  review: "Ôn tập hôm nay",
  flashcard: "Flashcard",
  learn: "Học thông minh",
  mcq: "Trắc nghiệm",
  typing: "Gõ từ",
  dictation: "Nghe chép",
  cloze: "Điền từ",
  speaking: "Luyện nói",
  match: "Ghép cặp",
  test: "Kiểm tra",
};

function SectionTitle({ children }: { children: string }) {
  return <Text className="pb-1 text-caption font-semibold uppercase text-textMuted">{children}</Text>;
}

function Levels({ overview }: { overview: StatsOverview }) {
  return (
    <Card className="gap-2">
      <SectionTitle>Mức thuộc</SectionTitle>
      <View className="flex-row gap-2">
        {LEVELS.map((level) => (
          <View key={level} className="flex-1 items-center rounded-xl bg-background py-3">
            <Text className={`text-[22px] font-bold ${LEVEL_TEXT_CLASS[level]}`}>
              {overview.levels[level]}
            </Text>
            <Text className="text-caption text-textMuted">{LEVEL_LABELS[level]}</Text>
          </View>
        ))}
      </View>
      <Text className="text-caption text-textMuted">
        Chuỗi hiện tại {overview.streak_current} ngày · Kỷ lục {overview.streak_best} ngày ·{" "}
        {overview.due_today} từ cần ôn hôm nay
      </Text>
    </Card>
  );
}

/** Biểu đồ cột số thẻ mỗi ngày trong 30 ngày (react-native-gifted-charts). */
function DailyChart({ days }: { days: DailyStat[] }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const chartWidth = width - 32 - 32 - 36; // lề màn hình, lề thẻ, trục Y
  const spacing = 3;
  const barWidth = Math.max(4, Math.floor(chartWidth / days.length) - spacing);
  const total = days.reduce((sum, day) => sum + day.cards_done, 0);
  const seconds = days.reduce((sum, day) => sum + day.study_seconds, 0);
  const activeDays = days.filter((day) => day.cards_done > 0).length;
  const data = days.map((day, index) => ({
    value: day.cards_done,
    frontColor: index === days.length - 1 ? colors.primary : colors.success,
    // nhãn ngày (dd/MM) cách 7 ngày một lần từ ngày đầu; bỏ nhãn trong 3 cột cuối (bị cắt ở mép phải)
    label:
      index % 7 === 0 && index < days.length - 3
        ? `${day.date.slice(8, 10)}/${day.date.slice(5, 7)}`
        : "",
  }));

  return (
    <Card className="gap-2">
      <SectionTitle>30 ngày gần đây</SectionTitle>
      <Text className="text-body text-text">
        {total} thẻ · {activeDays} ngày có học · {formatDuration(seconds)}
      </Text>
      {total === 0 ? (
        <Text className="py-6 text-center text-body text-textMuted">Chưa học ngày nào trong 30 ngày qua.</Text>
      ) : (
        <View accessible accessibilityLabel={`Biểu đồ 30 ngày: tổng ${total} thẻ, ${activeDays} ngày có học`}>
          <BarChart
            data={data}
            barWidth={barWidth}
            spacing={spacing}
            initialSpacing={2}
            endSpacing={2}
            barBorderTopLeftRadius={2}
            barBorderTopRightRadius={2}
            noOfSections={4}
            height={140}
            width={chartWidth}
            yAxisThickness={0}
            xAxisThickness={1}
            xAxisColor={colors.textMuted}
            rulesColor={colors.textMuted}
            rulesType="solid"
            yAxisTextStyle={{ color: colors.textMuted, fontSize: 11 }}
            xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 10, width: 40, marginLeft: -6 }}
            disableScroll
            disablePress
          />
        </View>
      )}
    </Card>
  );
}

function Accuracy({ overview }: { overview: StatsOverview }) {
  const rows = overview.accuracy_30d.filter((row) => row.total > 0);
  return (
    <Card className="gap-3">
      <SectionTitle>Độ chính xác 30 ngày</SectionTitle>
      {rows.length === 0 ? (
        <Text className="text-body text-textMuted">Chưa có câu trả lời nào trong 30 ngày qua.</Text>
      ) : (
        rows.map((row) => {
          const percent = Math.round((row.correct / row.total) * 100);
          return (
            <View key={row.mode} className="gap-1">
              <View className="flex-row justify-between">
                <Text className="text-body text-text">{MODE_LABELS[row.mode] ?? row.mode}</Text>
                <Text className="text-body font-semibold text-text">
                  {percent}% <Text className="text-caption text-textMuted">({row.correct}/{row.total})</Text>
                </Text>
              </View>
              <ProgressBar
                value={row.correct / row.total}
                accessibilityLabel={`${MODE_LABELS[row.mode] ?? row.mode}: đúng ${percent}%`}
              />
            </View>
          );
        })
      )}
      <Text className="text-caption text-textMuted">Chỉ tính lần trả lời đầu của mỗi từ trong phiên.</Text>
    </Card>
  );
}

function HardWords() {
  const { colors } = useTheme();
  const { data, isPending, isError, refetch } = useHardWords(10);
  return (
    <Card className="gap-1">
      <SectionTitle>Từ hay sai</SectionTitle>
      {isPending ? (
        <ActivityIndicator className="py-4" />
      ) : isError && !data ? (
        <View className="gap-2">
          <Text className="text-body text-danger">Không tải được danh sách từ hay sai.</Text>
          <Button title="Thử lại" variant="secondary" onPress={() => refetch()} />
        </View>
      ) : !data?.length ? (
        <Text className="text-body text-textMuted">Chưa có từ nào bị sai. Tuyệt vời!</Text>
      ) : (
        data.map((word) => (
          <Pressable
            key={word.word_id}
            accessibilityRole="button"
            accessibilityLabel={`${word.term}, ${word.meaning_vi}, sai ${word.wrong_count} lần, quên ${word.lapses} lần`}
            onPress={() => router.push({ pathname: "/word/[id]", params: { id: word.word_id } })}
            className="min-h-[52px] flex-row items-center gap-3 border-t border-textMuted/10 py-2 active:opacity-70"
          >
            <View className="flex-1">
              <Text className="text-body font-semibold text-text">{word.term}</Text>
              <Text className="text-caption text-textMuted" numberOfLines={1}>
                {word.meaning_vi}
              </Text>
            </View>
            <Text className="text-caption text-danger">
              sai {word.wrong_count} · quên {word.lapses}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))
      )}
    </Card>
  );
}

export default function StatsScreen() {
  const client = useQueryClient();
  const overview = useStatsOverview();
  const daily = useStatsDaily(30);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await client.invalidateQueries({ queryKey: ["stats"] });
    } finally {
      setRefreshing(false);
    }
  };

  let body;
  if (overview.isPending || daily.isPending) {
    body = <ActivityIndicator className="py-12" />;
  } else if (overview.isError || daily.isError) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Không tải được thống kê"
        description={messageFor(overview.error ?? daily.error)}
        actionLabel="Thử lại"
        onAction={onRefresh}
      />
    );
  } else {
    const totalWords = LEVELS.reduce((sum, level) => sum + overview.data.levels[level], 0);
    body =
      totalWords === 0 ? (
        <EmptyState
          icon="bar-chart-outline"
          title="Chưa có số liệu"
          description="Thêm từ vào một list và học phiên đầu tiên để xem thống kê."
          actionLabel="Mở Thư viện"
          onAction={() => router.push("/library")}
        />
      ) : (
        <>
          <Levels overview={overview.data} />
          <DailyChart days={daily.data} />
          <StudyHeatmap goal={overview.data.today.goal} />
          <Accuracy overview={overview.data} />
          <HardWords />
        </>
      );
  }

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text className="pt-4 text-title font-bold text-text">Thống kê</Text>
      {body}
    </Screen>
  );
}
