import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";

type CategoryTileProps = {
  id: string; // "uncategorized" cho ô Chưa phân loại
  name: string;
  color: string;
  icon: string;
  listCount: number;
  pinned?: boolean;
};

export function CategoryTile({ id, name, color, icon, listCount, pinned }: CategoryTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${listCount} list`}
      onPress={() => router.push({ pathname: "/category/[id]", params: { id } })}
      // Màu danh mục do người dùng chọn (dữ liệu), không phải màu giao diện hardcode.
      style={{ backgroundColor: color }}
      className="min-h-[96px] flex-1 justify-between rounded-2xl p-4 active:opacity-80"
    >
      <View className="flex-row items-center justify-between">
        <Ionicons
          name={icon as ComponentProps<typeof Ionicons>["name"]}
          size={24}
          color="white"
        />
        {pinned ? <Ionicons name="pin" size={16} color="white" /> : null}
      </View>
      <View>
        <Text className="text-body font-semibold text-white" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-caption text-white/80">{listCount} list</Text>
      </View>
    </Pressable>
  );
}
