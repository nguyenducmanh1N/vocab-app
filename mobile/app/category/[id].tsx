import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";

import { messageFor } from "@/api/errorMessages";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { ListCard } from "@/features/library/ListCard";
import { useLibraryActions } from "@/features/library/useLibraryActions";
import { useCategories, useLists } from "@/hooks/useLibrary";

const UNCATEGORIZED = "uncategorized";

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isUncategorized = id === UNCATEGORIZED;
  const categories = useCategories();
  const lists = useLists(isUncategorized ? { uncategorized: true } : { category_id: id });
  const { createList, categoryMenu } = useLibraryActions();
  const [refreshing, setRefreshing] = useState(false);

  const category = categories.data?.find((c) => c.id === id);
  const title = isUncategorized ? "Chưa phân loại" : (category?.name ?? "");
  const categoryId = isUncategorized ? null : id;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([categories.refetch(), lists.refetch()]);
    setRefreshing(false);
  };

  const openMenu = async () => {
    if (category && (await categoryMenu(category))) router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: category
            ? () => <IconButton icon="ellipsis-horizontal-circle" accessibilityLabel="Tuỳ chọn danh mục" onPress={openMenu} />
            : undefined,
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-3 p-4 pb-10"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {lists.isPending ? (
          <ActivityIndicator className="py-8" />
        ) : lists.isError ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Không tải được danh sách"
            description={messageFor(lists.error)}
            actionLabel="Thử lại"
            onAction={onRefresh}
          />
        ) : !lists.data.length ? (
          <EmptyState
            icon="albums-outline"
            title="Danh mục chưa có list"
            description="Tạo list để bắt đầu thêm từ."
            actionLabel="Tạo list"
            onAction={() => createList(categoryId)}
          />
        ) : (
          <>
            {lists.data.map((list) => (
              <ListCard key={list.id} list={list} />
            ))}
            <View className="pt-2">
              <Button title="List mới" variant="secondary" onPress={() => createList(categoryId)} />
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}
