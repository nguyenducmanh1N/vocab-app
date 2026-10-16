import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { messageFor } from "@/api/errorMessages";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { useMatchRecordsStore } from "@/stores/matchRecordsStore";
import { useTheme } from "@/theme/useTheme";

import { finishToSummary } from "../finishSession";
import { formatMatchTime, type MatchTile } from "../match";
import { useMatchSession } from "../useMatchSession";
import { hapticResult, hapticSelect } from "./feedback";

const COLUMNS = 3;
const TABULAR = { fontVariant: ["tabular-nums" as const] }; // chữ số rộng đều: đồng hồ không nhảy
const FLASH_MS = 450; // ô vừa nối đúng/sai đổi màu trong chừng này rồi mới ẩn/trả về

type Flash = { tileIds: readonly string[]; correct: boolean };
type Outcome = { ms: number; previous: number | undefined; isRecord: boolean };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function Tile({
  tile,
  state,
  onPress,
}: {
  tile: MatchTile;
  state: "idle" | "selected" | "correct" | "wrong" | "hidden";
  onPress: () => void;
}) {
  const tone = {
    idle: "border-textMuted/30 bg-surface",
    selected: "border-primary bg-primary/10",
    correct: "border-success bg-success/10",
    wrong: "border-danger bg-danger/10",
    hidden: "border-transparent bg-transparent",
  }[state];
  const hidden = state === "hidden";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tile.side === "term" ? "Từ" : "Nghĩa"}: ${tile.text}`}
      accessibilityState={{ selected: state === "selected", disabled: hidden }}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      disabled={hidden}
      onPress={onPress}
      className={`max-h-[120px] flex-1 items-center justify-center rounded-xl border-2 p-2 ${tone}`}
    >
      {hidden ? null : (
        // Mọi ô cùng một cỡ chữ (không tự co theo độ dài); dài quá 4 dòng thì cắt bằng "…".
        <Text
          className={`text-center text-[15px] leading-5 text-text ${tile.side === "term" ? "font-bold" : ""}`}
          numberOfLines={4}
          ellipsizeMode="tail"
        >
          {tile.text}
        </Text>
      )}
    </Pressable>
  );
}

/** Đồng hồ chạy (cập nhật 10 lần/giây); dừng ở thời gian cả ván khi xong. */
function Timer({ startedAt, finalMs }: { startedAt: number; finalMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finalMs !== null) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [finalMs]);
  const ms = finalMs ?? now - startedAt;
  return (
    <Text
      className="min-w-[64px] pr-2 text-right text-body font-semibold text-text"
      style={TABULAR}
      accessibilityLabel={`Thời gian ${formatMatchTime(ms)}`}
    >
      {formatMatchTime(ms)}
    </Text>
  );
}

/** Ghép cặp (PLAN.md 10.3, P5.4): lưới 6 cặp từ–nghĩa, tính giờ, kỷ lục theo list lưu trên máy. */
export function MatchStudy() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { listId } = useLocalSearchParams<{ listId?: string }>();
  const session = useMatchSession(listId ?? null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [summaryReady, setSummaryReady] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // Nối hết: ghi kết quả, so kỷ lục, hiện bảng kết quả.
  useEffect(() => {
    if (!session.done || session.finalMs === null || finishedRef.current) return;
    finishedRef.current = true;
    const ms = session.finalMs;
    hapticResult(true);
    const best = listId
      ? useMatchRecordsStore.getState().submit(listId, session.pairCount, ms)
      : { previous: undefined, isRecord: false };
    setOutcome({ ms, ...best });
    finishToSummary(session.finish).then(setSummaryReady);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.done, session.finalMs]);

  const tap = (tileId: string) => {
    const result = session.tap(tileId);
    if (result.type === "select") hapticSelect();
    else if (result.type === "match") {
      hapticSelect();
      setFlash({ tileIds: result.tileIds, correct: true });
    } else if (result.type === "wrong") {
      hapticResult(false); // ghép sai: rung, tính một câu sai
      setFlash({ tileIds: result.tileIds, correct: false });
    }
  };

  const exit = () => {
    if (session.answered === 0 || finishedRef.current) {
      router.back();
      return;
    }
    Alert.alert("Dừng ván này?", "Các cặp đã nối vẫn được lưu, ván không tính kỷ lục.", [
      { text: "Chơi tiếp", style: "cancel" },
      {
        text: "Dừng",
        onPress: async () => {
          finishedRef.current = true;
          if (await finishToSummary(session.finish)) router.replace("/study/summary");
          else router.back();
        },
      },
    ]);
  };

  const playAgain = () => router.replace({ pathname: "/study/[mode]", params: { mode: "match", ...(listId ? { listId } : {}) } });

  const tileState = (tile: MatchTile) => {
    if (flash?.tileIds.includes(tile.id)) return flash.correct ? "correct" : "wrong";
    if (session.matchedWordIds.includes(tile.wordId)) return "hidden";
    return tile.id === session.selectedTileId ? "selected" : "idle";
  };

  let body;
  if (session.queue.isPending) {
    body = <ActivityIndicator className="flex-1" />;
  } else if (session.queue.isError) {
    body = (
      <EmptyState
        icon="cloud-offline-outline"
        title="Không tải được thẻ"
        description={messageFor(session.queue.error)}
        actionLabel="Thử lại"
        onAction={() => session.queue.refetch()}
      />
    );
  } else if (session.pairCount < 2) {
    body = (
      <EmptyState
        icon="grid-outline"
        title="Chưa đủ từ để ghép cặp"
        description="Cần ít nhất 2 từ khác nhau (khác cả chữ và nghĩa) trong list."
        actionLabel="Quay lại"
        onAction={() => router.back()}
      />
    );
  } else if (outcome) {
    body = (
      <View className="flex-1 items-center justify-center gap-4 px-6">
        <Ionicons name={outcome.isRecord ? "trophy" : "checkmark-circle"} size={64} color={colors.primary} />
        <Text className="text-[22px] font-bold text-text">
          {outcome.isRecord && outcome.previous !== undefined ? "Kỷ lục mới!" : "Hoàn thành!"}
        </Text>
        <Text className="text-[40px] font-bold text-text" style={TABULAR}>{formatMatchTime(outcome.ms)}</Text>
        <Text className="text-center text-body text-textMuted">
          {!listId
            ? `${session.pairCount} cặp`
            : outcome.previous === undefined
              ? `Kỷ lục đầu tiên của list này (${session.pairCount} cặp)`
              : outcome.isRecord
                ? `Kỷ lục cũ: ${formatMatchTime(outcome.previous)}`
                : `Kỷ lục: ${formatMatchTime(outcome.previous)}`}
        </Text>
        <View className="w-full gap-3 pt-2">
          <Button title="Xem tổng kết" disabled={!summaryReady} onPress={() => router.replace("/study/summary")} />
          <Button title="Ván mới" variant="secondary" onPress={playAgain} />
        </View>
      </View>
    );
  } else {
    body = (
      <View className="flex-1 gap-2 px-4 py-4">
        {chunk(session.tiles, COLUMNS).map((row, index) => (
          <View key={index} className="flex-1 flex-row gap-2">
            {row.map((tile) => (
              <Tile key={tile.id} tile={tile} state={tileState(tile)} onPress={() => tap(tile.id)} />
            ))}
          </View>
        ))}
        <Text className="pt-1 text-center text-caption text-textMuted">Chạm một từ rồi chạm nghĩa của nó</Text>
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View className="flex-row items-center gap-3 px-2">
        <IconButton icon="close" tone="muted" accessibilityLabel="Thoát ghép cặp" onPress={exit} />
        <Text className="flex-1 text-body font-semibold text-text">
          Ghép cặp{session.pairCount ? ` · ${session.matchedWordIds.length}/${session.pairCount}` : ""}
        </Text>
        {session.pairCount >= 2 ? <Timer startedAt={session.startedAt} finalMs={session.finalMs} /> : null}
      </View>
      {body}
    </View>
  );
}
