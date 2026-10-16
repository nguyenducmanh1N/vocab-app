import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { View, type ColorValue } from "react-native";

import { useTheme } from "@/theme/useTheme";

type IconName = ComponentProps<typeof Ionicons>["name"];

function tabIcon(active: IconName, inactive: IconName) {
  function TabIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? active : inactive} color={color} size={size} />;
  }
  return TabIcon;
}

// Nút giữa nổi bật: vòng tròn màu primary, nhô lên khỏi tab bar.
function AiTabIcon({ focused }: { focused: boolean }) {
  return (
    <View
      className="-mt-5 h-14 w-14 items-center justify-center rounded-full bg-primary shadow-md"
      style={{ shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}
    >
      <Ionicons name={focused ? "sparkles" : "sparkles-outline"} color="white" size={28} />
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Trang chủ", tabBarIcon: tabIcon("home", "home-outline") }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: "Thư viện", tabBarIcon: tabIcon("library", "library-outline") }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: "AI gợi ý",
          tabBarIcon: AiTabIcon,
          tabBarAccessibilityLabel: "AI gợi ý",
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{ title: "Thống kê", tabBarIcon: tabIcon("stats-chart", "stats-chart-outline") }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Cá nhân",
          tabBarIcon: tabIcon("person-circle", "person-circle-outline"),
        }}
      />
    </Tabs>
  );
}
