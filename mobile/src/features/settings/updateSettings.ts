/** Đổi cài đặt trong app: áp dụng ngay (settingsStore), đồng bộ PATCH /me sau 500 ms. */
import { Alert } from "react-native";

import { messageFor } from "@/api/errorMessages";
import { getMe, patchMe } from "@/api/me";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";

import { applyPatch, createSettingsSync, type SettingsPatch } from "./settingsSync";

const sync = createSettingsSync({
  send: (patch) => patchMe({ settings: patch }),
  onSaved: (user, hasPending) => {
    if (hasPending) {
      // Người dùng đã đổi tiếp: chỉ cập nhật hồ sơ, giữ nguyên giá trị local mới hơn.
      useAuthStore.setState({ user: { ...user, settings: useSettingsStore.getState().settings } });
    } else {
      useAuthStore.getState().setUser(user);
    }
  },
  onError: (error) => {
    Alert.alert("Không lưu được cài đặt", messageFor(error));
    // Trả về giá trị đang lưu trên server
    getMe()
      .then((user) => useAuthStore.getState().setUser(user))
      .catch(() => undefined);
  },
});

export function updateSettings(patch: SettingsPatch): void {
  const store = useSettingsStore.getState();
  store.setSettings(applyPatch(store.settings, patch));
  sync.update(patch);
}

/** Gửi ngay các thay đổi đang chờ (khi rời màn Cài đặt). */
export function flushSettings(): Promise<void> {
  return sync.flush();
}
