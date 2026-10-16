import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";

import { getStudyQueue } from "@/api/study";
import { usePendingSessions } from "@/features/study/usePendingSessions";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ProgressRing } from "@/components/ProgressRing";
import { Screen } from "@/components/Screen";
import { IconButton } from "@/components/IconButton";
import { useLists } from "@/hooks/useLibrary";
import { useStatsOverview } from "@/hooks/useStats";
import { useWordOfDay } from "@/hooks/useWordOfDay";
import { playWord } from "@/services/audio";
import { useAuthStore } from "@/stores/authStore";
import { useRecentListsStore } from "@/stores/recentListsStore";
import { useTheme } from "@/theme/useTheme";

const EXTRA_NEW = 5; // "Học thêm" mỗi lần 5 từ mới ngoài hạn mức

/** Nút Ôn tập hôm nay: N = số từ đến hạn (stats.due_total của /study/queue). */
function ReviewToday() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["study-queue", { mode: "review", listId: null }],
    // limit không ảnh hưởng stats; chỉ cần số đếm nên lấy 1 thẻ
    queryFn: ({ signal }) => getStudyQueue({ mode: "review", limit: 1 }, signal),
  });
  const due = data?.stats.due_total ?? 0;
  const fresh = data?.stats.new_available ?? 0;
  const finishedToday = !isPending && !!data && due + fresh === 0;
  // Đã ôn xong và hết hạn mức từ mới: xem kho còn từ mới để "Học thêm" không.
  const extra = useQuery({
    queryKey: ["study-queue", { mode: "review", listId: null, extra: EXTRA_NEW }],
    queryFn: ({ signal }) =>
      getStudyQueue({ mode: "review", limit: 1, extraNew: EXTRA_NEW }, signal),
    enabled: finishedToday,
  });
  const extraAvailable = finishedToday ? (extra.data?.stats.new_available ?? 0) : 0;

  // Lỗi tải: không báo "đã ôn xong" (dữ liệu trống không có nghĩa là hết từ).
  if (isError && !data) {
    return (
      <Card className="gap-2">
        <Text className="text-caption font-semibold uppercase text-textMuted">Học hôm nay</Text>
        <Text className="text-body text-danger">Không tải được danh sách ôn tập hôm nay.</Text>
        <Button title="Thử lại" variant="secondary" onPress={() => refetch()} />
      </Card>
    );
  }

  const title = isPending
    ? "Ôn tập hôm nay"
    : due > 0
      ? `Ôn tập hôm nay (${due})`
      : fresh > 0
        ? `Ôn tập hôm nay · ${fresh} từ mới`
        : "Hôm nay đã ôn xong";

  return (
    <Card className="gap-3">
      <Text className="text-caption font-semibold uppercase text-textMuted">Học hôm nay</Text>
      <Text className="text-body text-text">
        {due > 0
          ? `${due} từ đến hạn ôn${fresh > 0 ? `, ${fresh} từ mới` : ""}.`
          : fresh > 0
            ? `Không có từ đến hạn. Học ${fresh} từ mới hôm nay?`
            : extraAvailable > 0
              ? "Đã xong phần hôm nay. Muốn học thêm từ mới?"
              : "Không còn từ đến hạn. Quay lại vào ngày mai nhé!"}
      </Text>
      <Button
        title={title}
        loading={isPending}
        disabled={!isPending && due + fresh === 0}
        onPress={() => router.push({ pathname: "/study/[mode]", params: { mode: "review" } })}
      />
      {extraAvailable > 0 ? (
        <Button
          title={`Học thêm ${extraAvailable} từ mới`}
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: "/study/[mode]",
              params: { mode: "review", extra: String(EXTRA_NEW) },
            })
          }
        />
      ) : null}
    </Card>
  );
}

/** Kết quả học còn nằm trong hàng đợi offline (mất mạng lúc học): báo và cho gửi ngay. */
function PendingResults() {
  const { count, status, flushNow } = usePendingSessions();
  if (count === 0) return null;
  return (
    <Card className="gap-2 border border-warning/40">
      <Text className="text-body font-semibold text-text">
        {count} kết quả học chờ gửi
      </Text>
      <Text className="text-caption text-textMuted">
        {status === "failed"
          ? "Chưa gửi được, sẽ tự thử lại khi có mạng."
          : "Đã lưu trên máy, tự gửi khi có mạng."}
      </Text>
      <Button
        title="Gửi ngay"
        variant="secondary"
        loading={status === "sending"}
        onPress={flushNow}
      />
    </Card>
  );
}

function WordOfDay() {
  const { data: word } = useWordOfDay();
  if (!word) return null;
  return (
    <Card className="gap-2">
      <Text className="text-caption font-semibold uppercase text-textMuted">Từ của ngày</Text>
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="link"
          className="flex-1"
          onPress={() => router.push({ pathname: "/word/[id]", params: { id: word.id } })}
        >
          <Text className="text-word font-bold text-text">{word.term}</Text>
          {word.ipa ? <Text className="text-body text-textMuted">{word.ipa}</Text> : null}
        </Pressable>
        <IconButton
          icon="volume-high"
          size={28}
          accessibilityLabel={`Nghe cách đọc ${word.term}`}
          onPress={() => playWord(word.term, word.audio_url)}
        />
      </View>
      <Text className="text-body text-text">{word.meaning_vi}</Text>
      {word.examples[0] ? (
        <Text className="text-caption italic text-textMuted">{word.examples[0].en}</Text>
      ) : null}
    </Card>
  );
}

function greeting(hour: number): string {
  if (hour < 11) return "Chào buổi sáng";
  if (hour < 14) return "Chào buổi trưa";
  if (hour < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

/** Lời chào + streak (số ngày liên tiếp học đủ 10 thẻ). */
function Header() {
  const { colors } = useTheme();
  const name = useAuthStore((s) => s.user?.display_name);
  const [hour] = useState(() => new Date().getHours());
  const { data } = useStatsOverview();
  const streak = data?.streak_current ?? 0;
  return (
    <View className="flex-row items-center justify-between pt-4">
      <View className="flex-1">
        <Text className="text-body text-textMuted">{greeting(hour)},</Text>
        <Text className="text-title font-bold text-text" numberOfLines={1}>
          {name ?? "bạn"}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={`Chuỗi ${streak} ngày học liên tiếp`}
        className="flex-row items-center gap-1 rounded-full bg-surface px-3 py-2"
      >
        <Ionicons name="flame" size={22} color={streak > 0 ? colors.warning : colors.textMuted} />
        <Text className={`text-body font-bold ${streak > 0 ? "text-warning" : "text-textMuted"}`}>
          {streak}
        </Text>
      </View>
    </View>
  );
}

/** Vòng mục tiêu ngày: số thẻ hôm nay / daily_goal_cards. */
function TodayGoal() {
  const { colors } = useTheme();
  const { data, isPending, isError, refetch } = useStatsOverview();
  if (isPending) {
    return (
      <Card className="h-36 items-center justify-center">
        <ActivityIndicator />
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card className="gap-2">
        <Text className="text-body text-danger">Không tải được số liệu hôm nay.</Text>
        <Button title="Thử lại" variant="secondary" onPress={() => refetch()} />
      </Card>
    );
  }
  const { today, streak_best } = data;
  const met = today.goal_met;
  return (
    <Card className="flex-row items-center gap-5">
      <ProgressRing
        value={today.goal ? today.cards_done / today.goal : 0}
        color={met ? colors.success : colors.primary}
        accessibilityLabel={`Mục tiêu hôm nay: ${today.cards_done} trên ${today.goal} thẻ`}
      >
        <Text className="text-[26px] font-bold text-text">{today.cards_done}</Text>
        <Text className="text-caption text-textMuted">/ {today.goal} thẻ</Text>
      </ProgressRing>
      <View className="flex-1 gap-1">
        <Text className="text-caption font-semibold uppercase text-textMuted">Mục tiêu hôm nay</Text>
        <Text className={`text-body font-semibold ${met ? "text-success" : "text-text"}`}>
          {met
            ? "Đã đạt mục tiêu!"
            : today.cards_done === 0
              ? "Chưa học thẻ nào hôm nay"
              : `Còn ${today.goal - today.cards_done} thẻ nữa`}
        </Text>
        <Text className="text-caption text-textMuted">
          {today.new_words} từ mới · {today.correct} câu đúng
        </Text>
        {streak_best > 0 ? (
          <Text className="text-caption text-textMuted">Kỷ lục chuỗi: {streak_best} ngày</Text>
        ) : null}
      </View>
    </Card>
  );
}

const RECENT_COUNT = 3;

/** List học gần đây (ghi trên máy khi học xong); thiếu thì bù list mới cập nhật. */
function RecentLists() {
  const { colors } = useTheme();
  const { data: lists, isPending } = useLists();
  const recentIds = useRecentListsStore((s) => s.ids);
  if (isPending) return null;
  const all = lists ?? [];
  if (all.length === 0) {
    return (
      <Card className="gap-3">
        <Text className="text-caption font-semibold uppercase text-textMuted">List học gần đây</Text>
        <Text className="text-body text-text">Chưa có list nào. Tạo list đầu tiên để bắt đầu học.</Text>
        <Button title="Mở Thư viện" variant="secondary" onPress={() => router.push("/library")} />
      </Card>
    );
  }
  const byId = new Map(all.map((list) => [list.id, list]));
  const recent = recentIds.flatMap((id) => byId.get(id) ?? []);
  const rest = [...all]
    .filter((list) => !recentIds.includes(list.id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const shown = [...recent, ...rest].slice(0, RECENT_COUNT);

  return (
    <Card className="gap-1">
      <Text className="pb-1 text-caption font-semibold uppercase text-textMuted">List học gần đây</Text>
      {shown.map((list) => (
        <Pressable
          key={list.id}
          accessibilityRole="button"
          accessibilityLabel={`${list.name}, ${list.word_count} từ, ${list.due_count} từ đến hạn`}
          onPress={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
          className="min-h-[52px] flex-row items-center gap-3 py-2 active:opacity-70"
        >
          <View className="flex-1">
            <Text className="text-body font-semibold text-text" numberOfLines={1}>
              {list.name}
            </Text>
            <Text className="text-caption text-textMuted">
              {list.word_count} từ · {list.mastered_count} thuộc
            </Text>
          </View>
          {list.due_count > 0 ? (
            <Text className="text-caption font-semibold text-warning">{list.due_count} đến hạn</Text>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      ))}
    </Card>
  );
}

export default function HomeScreen() {
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        ["stats", "study-queue", "lists", "word-of-day"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Header />
      <PendingResults />
      <TodayGoal />
      <ReviewToday />
      <RecentLists />
      {/* Từ của ngày: nối dữ liệu đầy đủ ở P4.3 */}
      <WordOfDay />
    </Screen>
  );
}
