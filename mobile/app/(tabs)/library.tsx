import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { messageFor } from "@/api/errorMessages";
import type { WordSearchOut } from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { Input } from "@/components/Input";
import { CategoryTile } from "@/features/library/CategoryTile";
import { pickOption } from "@/features/library/dialogs";
import { ListCard } from "@/features/library/ListCard";
import { useLibraryActions } from "@/features/library/useLibraryActions";
import { useCategories, useLists, useWordSearch } from "@/hooks/useLibrary";
import { useTheme } from "@/theme/useTheme";

function SearchResult({ word }: { word: WordSearchOut }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/word/[id]", params: { id: word.id } })}
      className="gap-1 rounded-2xl bg-surface p-4 active:opacity-80"
    >
      <Text className="text-body font-semibold text-text">{word.term}</Text>
      <Text className="text-caption text-textMuted" numberOfLines={2}>
        {word.meaning_vi}
      </Text>
      <Text className="text-caption text-primary">{word.list_name}</Text>
    </Pressable>
  );
}

function SearchResults({ q }: { q: string }) {
  const search = useWordSearch(q);
  if (search.isPending || search.isFetching) {
    return <ActivityIndicator className="py-8" />;
  }
  if (search.isError) {
    return <Text className="py-8 text-center text-body text-danger">{messageFor(search.error)}</Text>;
  }
  if (!search.data?.length) {
    return <Text className="py-8 text-center text-body text-textMuted">Không tìm thấy từ nào.</Text>;
  }
  return (
    <View className="gap-3">
      {search.data.map((word) => (
        <SearchResult key={word.id} word={word} />
      ))}
    </View>
  );
}

export default function LibraryScreen() {
  const { colors } = useTheme();
  const [q, setQ] = useState("");
  const categories = useCategories();
  const lists = useLists();
  const uncategorized = useLists({ uncategorized: true });
  const { createCategory, createList } = useLibraryActions();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([categories.refetch(), lists.refetch(), uncategorized.refetch()]);
    setRefreshing(false);
  };

  const openAddMenu = async () => {
    const choice = await pickOption("Thêm mới", ["List mới", "Danh mục mới"]);
    if (choice === 0) await createList();
    if (choice === 1) await createCategory();
  };

  const loading = categories.isPending || lists.isPending;
  const error = categories.error ?? lists.error;
  const isEmpty = !loading && !error && !categories.data?.length && !lists.data?.length;
  const tiles = [
    ...(categories.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      listCount: c.list_count,
      pinned: c.is_pinned,
    })),
    ...(uncategorized.data?.length
      ? [
          {
            id: "uncategorized",
            name: "Chưa phân loại",
            color: colors.textMuted,
            icon: "file-tray-outline",
            listCount: uncategorized.data.length,
            pinned: false,
          },
        ]
      : []),
  ];

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-4 pt-4">
        <Text className="text-title font-bold text-text">Thư viện</Text>
        <IconButton icon="add-circle" size={32} accessibilityLabel="Thêm list hoặc danh mục" onPress={openAddMenu} />
      </View>
      <View className="px-4 pb-2 pt-2">
        <Input
          value={q}
          onChangeText={setQ}
          placeholder="Tìm từ hoặc nghĩa (không cần dấu)"
          accessibilityLabel="Tìm kiếm từ"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          right={<Ionicons name="search" size={20} color={colors.textMuted} style={{ marginRight: 12 }} />}
        />
      </View>
      <ScrollView
        contentContainerClassName="gap-4 px-4 pb-8"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {q.trim() ? (
          <SearchResults q={q} />
        ) : loading ? (
          <ActivityIndicator className="py-8" />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Không tải được thư viện"
            description={messageFor(error)}
            actionLabel="Thử lại"
            onAction={onRefresh}
          />
        ) : isEmpty ? (
          <EmptyState
            icon="library-outline"
            title="Thư viện còn trống"
            description="Tạo list đầu tiên rồi thêm từ bạn muốn học."
            actionLabel="Tạo list đầu tiên"
            onAction={() => createList()}
          />
        ) : (
          <>
            {tiles.length ? (
              <View className="gap-3">
                <Text className="text-body font-semibold text-text">Danh mục</Text>
                {Array.from({ length: Math.ceil(tiles.length / 2) }, (_, row) => (
                  <View key={row} className="flex-row gap-3">
                    {tiles.slice(row * 2, row * 2 + 2).map((tile) => (
                      <CategoryTile key={tile.id} {...tile} />
                    ))}
                    {tiles.length % 2 === 1 && row === Math.ceil(tiles.length / 2) - 1 ? (
                      <View className="flex-1" />
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
            <View className="gap-3">
              <Text className="text-body font-semibold text-text">Tất cả list</Text>
              {lists.data?.length ? (
                lists.data.map((list) => <ListCard key={list.id} list={list} />)
              ) : (
                <EmptyState
                  icon="albums-outline"
                  title="Chưa có list nào"
                  actionLabel="Tạo list"
                  onAction={() => createList()}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
