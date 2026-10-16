import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import type { ListOut } from "@/api/types";
import { ProgressBar } from "@/components/ProgressBar";

export function ListCard({ list }: { list: ListOut }) {
  const mastered = list.word_count ? list.mastered_count / list.word_count : 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
      className="gap-3 rounded-2xl bg-surface p-4 active:opacity-80"
    >
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-body font-semibold text-text" numberOfLines={2}>
          {list.name}
        </Text>
        {list.due_count > 0 ? (
          <Text className="text-caption font-semibold text-warning">{list.due_count} đến hạn</Text>
        ) : null}
      </View>
      <ProgressBar value={mastered} accessibilityLabel={`Đã thuộc ${Math.round(mastered * 100)}%`} />
      <Text className="text-caption text-textMuted">
        {list.word_count} từ · thuộc {Math.round(mastered * 100)}%
      </Text>
    </Pressable>
  );
}
