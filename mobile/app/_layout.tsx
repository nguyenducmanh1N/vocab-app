import "../global.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Appearance, AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { queryClient } from "@/api/queryClient";
import { ServerWakeScreen } from "@/components/ServerWakeScreen";
import { useServerWarmup } from "@/features/server/useServerWarmup";
import { studyQueue } from "@/features/study/studyQueue";
import { configureAudio } from "@/services/audio";
import {
  cancelAllNotifications,
  configureNotifications,
  rescheduleAll,
  useNotificationRouting,
} from "@/services/notifications";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { themeVars, withAlpha } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

const STUDY_SCREEN = { gestureEnabled: false, animation: "slide_from_bottom" } as const;

// Giữ splash tới khi biết đã đăng nhập hay chưa (đọc token → GET /me).
SplashScreen.preventAutoHideAsync();
// Vẫn nghe được phát âm khi iPhone gạt công tắc im lặng (PLAN.md 10.4).
configureAudio().catch(() => undefined);
// Thông báo vẫn hiện khi app đang mở (PLAN.md 10.5).
configureNotifications();

export default function RootLayout() {
  const { scheme, colors } = useTheme();
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // Đánh thức máy chủ (gói free ngủ khi lâu không dùng) rồi mới khôi phục phiên đăng nhập.
  const warmup = useServerWarmup();
  useEffect(() => {
    if (warmup.phase === "ready") bootstrap();
  }, [warmup.phase, bootstrap]);

  useEffect(() => {
    if (status !== "loading" || warmup.phase === "waking") SplashScreen.hideAsync();
  }, [status, warmup.phase]);

  // Lúc mở app và mỗi khi app vào foreground: gửi lại kết quả học còn trong hàng đợi offline,
  // rồi làm lại lịch thông báo (10.5).
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (status !== "signedIn" || !userId) return;
    const onActive = () => {
      studyQueue
        .flush(userId)
        .catch(() => undefined)
        .then(() => rescheduleAll())
        .catch(() => undefined); // mất mạng: giữ lịch cũ
    };
    onActive();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") onActive();
    });
    return () => subscription.remove();
  }, [status, userId]);

  // Giao diện theo cài đặt (system/light/dark): đổi cả useColorScheme lẫn control gốc của iOS.
  const theme = useSettingsStore((s) => s.settings.theme);
  useEffect(() => {
    Appearance.setColorScheme(theme === "system" ? "unspecified" : theme);
  }, [theme]);

  // Đổi cài đặt thông báo → làm lại lịch.
  const notifyKey = useSettingsStore((s) => JSON.stringify(s.settings.notify));
  useEffect(() => {
    if (status === "signedIn") rescheduleAll().catch(() => undefined);
  }, [status, notifyKey]);

  // Đăng xuất → huỷ mọi thông báo đã lên lịch của tài khoản cũ.
  useEffect(() => {
    if (status === "signedOut") cancelAllNotifications().catch(() => undefined);
  }, [status]);

  // Bấm thông báo → mở đúng màn (vd. /word/<id>).
  useNotificationRouting(status === "signedIn");

  if (warmup.phase === "waking") {
    return (
      <SafeAreaProvider>
        <View style={themeVars[scheme]} className="flex-1 bg-background">
          <ServerWakeScreen
            attempt={warmup.attempt}
            canSkip={warmup.canSkip}
            onRetry={warmup.retryNow}
            onSkip={warmup.skip}
          />
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        </View>
      </SafeAreaProvider>
    );
  }
  if (status === "loading") return null;

  // Theme của React Navigation lấy từ token: không có thì tab bar dùng viền và nền của theme sáng
  // mặc định (vệt xám sáng trên tab bar ở chế độ tối).
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: withAlpha(colors.textMuted, 0.2),
      notification: colors.danger,
    },
  };

  const detailHeader = {
    headerShown: true,
    headerBackTitle: "Quay lại",
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.background },
    headerTitleStyle: { color: colors.text },
    headerShadowVisible: false,
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <View style={themeVars[scheme]} className="flex-1 bg-background">
            <ThemeProvider value={navTheme}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              {/* Đổi status (đăng nhập, đăng xuất, refresh lỗi) thì router tự chuyển nhóm màn hình. */}
              <Stack.Protected guard={status === "signedIn"}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="category/[id]" options={detailHeader} />
                <Stack.Screen name="list/[id]" options={detailHeader} />
                <Stack.Screen name="word/[id]" options={detailHeader} />
                <Stack.Screen
                  name="list/import"
                  options={{ ...detailHeader, presentation: "modal", title: "Nhập nhanh" }}
                />
                <Stack.Screen name="list/cloze" options={detailHeader} />
                <Stack.Screen name="settings/index" options={{ ...detailHeader, title: "Cài đặt" }} />
                <Stack.Screen name="ai/preview" options={{ ...detailHeader, title: "Xem trước" }} />
                {/*
                  Màn học và tổng kết: màn thường (card) che cả tab, trượt lên từ dưới, tắt vuốt
                  quay lại. Không dùng fullScreenModal: router.replace giữa các modal làm màn mới
                  bị ẩn khỏi cây trợ năng (VoiceOver không đọc được) trên iOS.
                */}
                <Stack.Screen name="study/[mode]" options={STUDY_SCREEN} />
                {/* Popup chọn cách học: modal trong suốt của navigator (không dùng Modal RN). */}
                <Stack.Screen
                  name="study/choose"
                  options={{
                    presentation: "transparentModal",
                    animation: "fade",
                    contentStyle: { backgroundColor: "transparent" },
                  }}
                />
                {/* Sheet đồng ý dùng AI (PLAN.md 10.1): cùng kiểu với popup chọn cách học. */}
                <Stack.Screen
                  name="ai/consent"
                  options={{
                    presentation: "transparentModal",
                    animation: "fade",
                    contentStyle: { backgroundColor: "transparent" },
                  }}
                />
                <Stack.Screen name="study/summary" options={STUDY_SCREEN} />
                <Stack.Screen
                  name="word/edit"
                  options={{ ...detailHeader, presentation: "modal", headerBackTitle: "Huỷ" }}
                />
              </Stack.Protected>
              <Stack.Protected guard={status === "signedOut"}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
            </Stack>
            </ThemeProvider>
            <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          </View>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
