import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { ApiError } from "@/api/client";
import { exportAllCsv } from "@/api/me";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Screen } from "@/components/Screen";
import { deleteAccountAndSignOut } from "@/features/auth/deleteAccount";
import { shareCsv } from "@/features/library/csvShare";
import { confirmDestructive, promptPassword, showError } from "@/features/library/dialogs";
import { cacheSize, clearAudioCache } from "@/services/audioCache";
import { useAuthStore } from "@/stores/authStore";
import { useTheme } from "@/theme/useTheme";

export default function ProfileScreen() {
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const [signingOut, setSigningOut] = useState(false);
  const [audioBytes, setAudioBytes] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Mỗi lần mở tab thì đo lại dung lượng file phát âm đã lưu.
  useFocusEffect(
    useCallback(() => {
      setAudioBytes(cacheSize());
    }, []),
  );

  const clearAudio = () => {
    Alert.alert(
      "Xoá file phát âm đã lưu?",
      "Lần sau nghe, app sẽ tải lại khi có mạng (từ không tải được sẽ đọc bằng giọng máy).",
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Xoá",
          style: "destructive",
          onPress: () => {
            clearAudioCache();
            setAudioBytes(cacheSize());
          },
        },
      ],
    );
  };

  const confirmSignOut = () => {
    Alert.alert("Đăng xuất?", "Bạn sẽ cần đăng nhập lại để tiếp tục học.", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Đăng xuất",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          await signOut({ remote: true }); // app/_layout.tsx tự về màn đăng nhập
        },
      },
    ]);
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      await shareCsv(await exportAllCsv(), "VocabTopic - tất cả từ vựng");
    } catch (err) {
      showError(err, "Không xuất được từ vựng");
    } finally {
      setExporting(false);
    }
  };

  const askPasswordAndDelete = async (): Promise<void> => {
    const password = await promptPassword(
      "Nhập mật khẩu",
      `Xác nhận xoá tài khoản ${user?.email ?? ""}.`,
      "Xoá tài khoản",
    );
    if (!password) return;
    setDeleting(true);
    try {
      await deleteAccountAndSignOut(password); // xong thì app tự về màn đăng nhập
    } catch (err) {
      setDeleting(false);
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
        Alert.alert("Mật khẩu không đúng", "Tài khoản chưa bị xoá.", [
          { text: "Huỷ", style: "cancel" },
          { text: "Thử lại", onPress: () => void askPasswordAndDelete() },
        ]);
      } else {
        showError(err, "Không xoá được tài khoản");
      }
    }
  };

  const confirmDeleteAccount = async () => {
    const ok = await confirmDestructive(
      "Xoá tài khoản?",
      "Mọi danh mục, list, từ vựng, tiến độ và lịch sử học sẽ bị xoá vĩnh viễn, không khôi phục được.\n\n" +
        "Nếu muốn giữ từ vựng, hãy bấm Huỷ rồi dùng \"Xuất toàn bộ từ vựng (CSV)\" trước.",
      "Tiếp tục",
    );
    if (ok) await askPasswordAndDelete();
  };

  return (
    <Screen>
      <Text className="pt-4 text-title font-bold text-text">Cá nhân</Text>
      <Card className="gap-1">
        <Text className="text-body font-semibold text-text">{user?.display_name ?? "—"}</Text>
        <Text className="text-caption text-textMuted">{user?.email ?? ""}</Text>
      </Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cài đặt"
        accessibilityHint="Phát âm, học, giao diện, thông báo"
        onPress={() => router.push("/settings")}
        className="active:opacity-70"
      >
        <Card className="flex-row items-center gap-3">
          <Ionicons name="settings-outline" size={22} color={colors.primary} />
          <View className="flex-1">
            <Text className="text-body font-semibold text-text">Cài đặt</Text>
            <Text className="text-caption text-textMuted">Phát âm, học, giao diện, thông báo</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Card>
      </Pressable>
      <Card className="gap-2">
        <Text className="text-body font-semibold text-text">File phát âm đã lưu</Text>
        <Text className="text-caption text-textMuted">
          {(audioBytes / (1024 * 1024)).toFixed(1)} MB / tối đa 50 MB. Dùng để nghe khi offline; gỡ
          app sẽ xoá cùng app.
        </Text>
        <Button title="Xoá file phát âm" variant="secondary" onPress={clearAudio} disabled={!audioBytes} />
      </Card>
      <Card className="gap-2">
        <Text className="text-body font-semibold text-text">Dữ liệu của bạn</Text>
        <Text className="text-caption text-textMuted">
          File CSV gồm mọi từ của mọi list, mở được bằng Excel hoặc Numbers.
        </Text>
        <Button title="Xuất toàn bộ từ vựng (CSV)" variant="secondary" loading={exporting} onPress={exportAll} />
      </Card>
      <View className="mt-auto gap-2 pb-6">
        <Button
          title="Đăng xuất"
          variant="danger"
          loading={signingOut}
          disabled={deleting}
          onPress={confirmSignOut}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: deleting || signingOut, busy: deleting }}
          disabled={deleting || signingOut}
          onPress={confirmDeleteAccount}
          className="min-h-[44px] items-center justify-center active:opacity-70"
        >
          <Text className="text-body font-semibold text-danger">
            {deleting ? "Đang xoá tài khoản…" : "Xoá tài khoản"}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
