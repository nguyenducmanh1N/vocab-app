import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { messageFor } from "@/api/errorMessages";
import type { Level, WordFilters, WordOut } from "@/api/types";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { confirmDestructive, showError } from "@/features/library/dialogs";
import { LEVEL_LABELS } from "@/features/library/labels";
import { useListExtras } from "@/features/library/listExtras";
import { useLibraryActions } from "@/features/library/useLibraryActions";
import { WordRow } from "@/features/library/WordRow";
import { keys, useList, useWords } from "@/hooks/useLibrary";
import { useWordMutations } from "@/hooks/useLibraryMutations";
import { stopAll } from "@/services/audio";


const LEVELS: (Level | undefined)[] = [undefined, "new", "learning", "familiar", "mastered"];

function Stat({ value, label, tone = "text-text" }: { value: number; label: string; tone?: string }) {
  return (
    <View className="flex-1 items-center rounded-2xl bg-surface py-3">
      <Text className={`text-title font-bold ${tone}`}>{value}</Text>
      <Text className="text-caption text-textMuted">{label}</Text>
    </View>
  );
}

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [filters, setFilters] = useState<WordFilters>({});
  const list = useList(id);
  const words = useWords(id, filters);
  const { listMenu, duplicateList, duplicating } = useLibraryActions();
  const extras = useListExtras();
  const { remove } = useWordMutations();
  const client = useQueryClient();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  // Rời màn hình thì dừng âm thanh đang phát.
  useEffect(() => stopAll, []);

  // Sau phiên học, danh sách từ chỉ bị đánh dấu cũ (studyQueue): mở lại màn thì tải lại một lần.
  useFocusEffect(
    useCallback(() => {
      const wordsKey = keys.words(id, filters);
      if (client.getQueryState(wordsKey)?.isInvalidated) void client.refetchQueries({ queryKey: wordsKey });
    }, [client, id, filters]),
  );

  const items = useMemo(() => words.data?.pages.flatMap((page) => page.items) ?? [], [words.data]);
  const total = words.data?.pages[0]?.total ?? 0;
  const hasFilter = filters.level !== undefined || filters.starred !== undefined;

  const onRefresh = async () => {
    setRefreshing(true);
    // Kéo để tải lại ở đầu list: chỉ tải lại trang đầu, không tải lại mọi trang đã cuộn qua.
    await Promise.all([list.refetch(), client.resetQueries({ queryKey: keys.words(id, filters) })]);
    setRefreshing(false);
  };

  const addWord = () => router.push({ pathname: "/word/edit", params: { listId: id } });

  const removeWord = remove.mutateAsync;
  const deleteWord = useCallback(
    async (word: WordOut) => {
      const ok = await confirmDestructive(`Xoá "${word.term}"?`, "Tiến độ ôn của từ này cũng bị xoá.");
      if (!ok) return;
      try {
        await removeWord(word.id);
      } catch (err) {
        showError(err);
      }
    },
    [removeWord],
  );
  // Hàm ổn định + WordRow memo: các hàng không render lại khi màn đổi trạng thái (đang tải trang…).
  const renderWord = useCallback(
    ({ item }: { item: WordOut }) => <WordRow word={item} onDelete={deleteWord} />,
    [deleteWord],
  );


  const openMenu = async () => {
    if (list.data && (await listMenu(list.data))) router.back();
  };

  const header = (
    <View className="gap-4 px-4 pb-3 pt-4">
      {list.data?.description ? (
        <Text className="text-body text-textMuted">{list.data.description}</Text>
      ) : null}
      <View className="flex-row gap-3">
        <Stat value={list.data?.word_count ?? 0} label="Từ" />
        <Stat value={list.data?.mastered_count ?? 0} label="Thuộc" tone="text-success" />
        <Stat value={list.data?.due_count ?? 0} label="Đến hạn" tone="text-warning" />
      </View>
      {list.data ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          <Button
            title="AI gợi ý thêm"
            variant="secondary"
            loading={extras.busy === "suggest"}
            onPress={() => list.data && extras.suggestForList(list.data)}
          />
          <Button
            title="Luyện điền từ"
            variant="secondary"
            disabled={!list.data.word_count}
            onPress={() => router.push({ pathname: "/list/cloze", params: { listId: id } })}
          />
          <Button
            title="Xuất"
            variant="secondary"
            loading={extras.busy === "export"}
            disabled={!list.data.word_count}
            onPress={() => list.data && extras.exportList(list.data)}
          />
          <Button
            title="Nhân bản"
            variant="secondary"
            loading={duplicating}
            onPress={() => list.data && duplicateList(list.data)}
          />
        </ScrollView>
      ) : null}
      <View className="flex-row items-center justify-between">
        <Text className="text-body font-semibold text-text">
          {hasFilter ? `${total} từ khớp bộ lọc` : `${total} từ`}
        </Text>
        <View className="flex-row">
          <Button
            title="Nhập nhanh"
            variant="ghost"
            onPress={() => router.push({ pathname: "/list/import", params: { listId: id } })}
          />
          <Button title="Thêm từ" variant="ghost" onPress={addWord} />
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {LEVELS.map((level) => (
          <Chip
            key={level ?? "all"}
            label={level ? LEVEL_LABELS[level] : "Tất cả"}
            selected={filters.level === level}
            onPress={() => setFilters((f) => ({ ...f, level }))}
          />
        ))}
        <Chip
          label="★ Gắn sao"
          selected={filters.starred === true}
          onPress={() => setFilters((f) => ({ ...f, starred: f.starred ? undefined : true }))}
        />
      </ScrollView>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: list.data?.name ?? "",
          headerRight: list.data
            ? () => (
                <IconButton
                  icon="ellipsis-horizontal-circle"
                  accessibilityLabel="Tuỳ chọn list"
                  onPress={openMenu}
                />
              )
            : undefined,
        }}
      />
      <View className="flex-1 bg-background">
        <FlashList
          data={items}
          keyExtractor={(word) => word.id}
          renderItem={renderWord}
          ListHeaderComponent={header}
          ListEmptyComponent={
            words.isPending ? (
              <ActivityIndicator className="py-8" />
            ) : words.isError ? (
              <EmptyState
                icon="cloud-offline-outline"
                title="Không tải được từ"
                description={messageFor(words.error)}
                actionLabel="Thử lại"
                onAction={onRefresh}
              />
            ) : hasFilter ? (
              <EmptyState
                icon="filter-outline"
                title="Không có từ nào khớp bộ lọc"
                actionLabel="Bỏ lọc"
                onAction={() => setFilters({})}
              />
            ) : (
              <EmptyState
                icon="add-circle-outline"
                title="List chưa có từ"
                description="Thêm từ đầu tiên, có thể bấm Tự điền để lấy IPA và từ loại."
                actionLabel="Thêm từ"
                onAction={addWord}
              />
            )
          }
          ListFooterComponent={
            words.isFetchingNextPage ? (
              <ActivityIndicator className="py-4" />
            ) : words.isFetchNextPageError ? (
              // Tải trang tiếp lỗi: onEndReached không gọi lại khi đang ở cuối, nên cần nút.
              <View className="items-center gap-2 px-4 py-4">
                <Text className="text-center text-caption text-danger">{messageFor(words.error)}</Text>
                <Button title="Tải tiếp" variant="secondary" onPress={() => words.fetchNextPage()} />
              </View>
            ) : (
              <View className="h-10" />
            )
          }
          onEndReached={() => {
            if (words.hasNextPage && !words.isFetchingNextPage) words.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        {/* Nút Học cố định ở đáy: cuộn sâu trong list vẫn bấm được, không phải cuộn ngược lên. */}
        {list.data?.word_count ? (
          <View
            className="border-t border-textMuted/10 bg-background px-4 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <Button
              title="Học"
              onPress={() => router.push({ pathname: "/study/choose", params: { listId: id } })}
            />
          </View>
        ) : null}
      </View>
    </>
  );
}
