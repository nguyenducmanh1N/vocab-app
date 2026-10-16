import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { claimGoalCelebration } from "@/features/study/goalCelebration";
import { formatDuration, retrySource, summarize } from "@/features/study/summary";
import { Celebration } from "@/features/study/ui/Celebration";
import { hapticResult } from "@/features/study/ui/feedback";
import { playWord, stopAll } from "@/services/audio";
import { ensurePermission, rescheduleAll } from "@/services/notifications";
import { useAuthStore } from "@/stores/authStore";
import { useStudySummaryStore } from "@/stores/studySummaryStore";
import { useTheme } from "@/theme/useTheme";

function Stat({ value, label, tone = "text-text" }: { value: string; label: string; tone?: string }) {
  return (
    <View className="flex-1 items-center gap-1 rounded-2xl bg-surface px-2 py-4">
      <Text className={`text-[24px] font-bold ${tone}`} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text className="text-caption text-textMuted">{label}</Text>
    </View>
  );
}

/** Tổng kết phiên (PLAN.md 10.1, 10.3 bước 5): số câu, số đúng, thời gian, từ sai. */
export default function SummaryScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const record = useStudySummaryStore((s) => s.record);
  const result = useStudySummaryStore((s) => s.result);
  const userId = useAuthStore((s) => s.user?.id);
  const summary = useMemo(() => (record ? summarize(record) : null), [record]);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => stopAll, []);

  // Sau phiên học: xin quyền thông báo (chỉ hỏi lần đầu) rồi làm lại lịch (PLAN.md 10.5).
  useEffect(() => {
    ensurePermission()
      .then(() => rescheduleAll())
      .catch(() => undefined);
  }, []);

  // Chúc mừng khi server báo đạt mục tiêu, chỉ lần đầu trong ngày.
  const goalMet = result?.today.goal_met === true;
  useEffect(() => {
    if (!goalMet || !userId) return;
    let active = true;
    claimGoalCelebration(userId).then((first) => {
      if (first && active) {
        setCelebrate(true);
        hapticResult(true);
      }
    });
    return () => {
      active = false;
    };
  }, [goalMet, userId]);

  if (!record || !summary) {
    return (
      <View className="flex-1 justify-center bg-background">
        <EmptyState
          icon="document-text-outline"
          title="Không có phiên học nào để tổng kết"
          actionLabel="Đóng"
          onAction={() => router.back()}
        />
      </View>
    );
  }

  const percent = summary.total ? Math.round((summary.correct / summary.total) * 100) : 0;
  const retry = () => {
    useStudySummaryStore.getState().setRetry(retrySource(record));
    router.replace({
      pathname: "/study/[mode]",
      params: { mode: "mcq", retry: "1", ...(record.listId ? { listId: record.listId } : {}) },
    });
  };

  let today: string;
  if (result === undefined) today = "Đang lưu kết quả…";
  else if (result === null) today = "Đang mất mạng: kết quả đã lưu trên máy và sẽ tự gửi khi có mạng.";
  else
    today = `Hôm nay: ${result.today.cards_done}/${result.today.goal} thẻ${
      result.today.goal_met ? " · Đạt mục tiêu" : ""
    }${result.today.streak_current ? ` · Chuỗi ${result.today.streak_current} ngày` : ""}`;

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <ScrollView contentContainerClassName="gap-4 px-4 pb-4 pt-6">
        <Text className="text-center text-title font-bold text-text">
          {summary.wrong === 0 ? "Tuyệt vời!" : "Xong phiên học"}
        </Text>
        <View className="flex-row gap-3">
          <Stat value={String(summary.total)} label="Câu đã làm" />
          <Stat value={`${summary.correct} · ${percent}%`} label="Đúng" tone="text-success" />
          <Stat value={formatDuration(summary.durationSec)} label="Thời gian" />
        </View>
        <Text
          className={`text-center text-body ${result === null ? "text-warning" : "text-textMuted"}`}
          accessibilityLiveRegion="polite"
        >
          {today}
        </Text>

        <Text className="pt-2 text-body font-semibold text-text">
          {summary.wrongCards.length ? `Từ cần ôn lại (${summary.wrongCards.length})` : "Từ cần ôn lại"}
        </Text>
        {summary.wrongCards.length === 0 ? (
          <Text className="text-body text-textMuted">Không sai câu nào 🎉</Text>
        ) : (
          <View className="overflow-hidden rounded-2xl bg-surface">
            {summary.wrongCards.map((card, index) => (
              <View
                key={card.id}
                className={`flex-row items-center ${index ? "border-t border-textMuted/10" : ""}`}
              >
                <Pressable
                  accessibilityRole="button"
                  // Nhãn rõ ràng: không để VoiceOver đọc ký tự của icon loa.
                  accessibilityLabel={`${card.term}, ${card.meaning_vi}`}
                  accessibilityHint="Chạm để nghe"
                  onPress={() => playWord(card.term, card.audio_url)}
                  className="flex-1 flex-row items-center gap-3 py-3 pl-4 active:opacity-70"
                >
                  <Ionicons name="volume-high-outline" size={20} color={colors.primary} />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-body font-semibold text-text">{card.term}</Text>
                    {card.ipa ? <Text className="text-caption text-textMuted">{card.ipa}</Text> : null}
                    <Text className="text-caption text-text" numberOfLines={2}>
                      {card.meaning_vi}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Xem chi tiết ${card.term}`}
                  onPress={() => router.push({ pathname: "/word/[id]", params: { id: card.id } })}
                  className="h-14 w-12 items-center justify-center active:opacity-60"
                >
                  <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View className="gap-3 px-4 pt-2">
        {summary.wrongCards.length ? (
          <Button title={`Ôn lại từ sai (${summary.wrongCards.length})`} onPress={retry} />
        ) : null}
        <Button
          title="Xong"
          variant={summary.wrongCards.length ? "secondary" : "primary"}
          onPress={() => router.back()}
        />
      </View>
      {celebrate ? <Celebration /> : null}
    </View>
  );
}
