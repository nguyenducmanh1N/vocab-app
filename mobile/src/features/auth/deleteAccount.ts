/**
 * Xoá tài khoản (PLAN.md 8.3): server xoá mọi dữ liệu, app dọn dữ liệu trên máy rồi đăng xuất.
 * Sai mật khẩu thì ném ApiError INVALID_CREDENTIALS và không dọn gì.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { deleteAccount } from "@/api/me";
import { clearAudioCache } from "@/services/audioCache";
import { useAuthStore } from "@/stores/authStore";
import { useMatchRecordsStore } from "@/stores/matchRecordsStore";
import { useRecentListsStore } from "@/stores/recentListsStore";
import { useSuggestStore } from "@/stores/suggestStore";

// Mọi khoá AsyncStorage của app đều bắt đầu bằng "vt.": hàng đợi phiên học offline, list gần
// đây, bản nháp, kỷ lục ghép cặp, đồng ý gửi bản ghi luyện nói, chúc mừng mục tiêu.
const LOCAL_PREFIX = "vt.";

async function clearLocalData(): Promise<void> {
  // Store persist giữ bản sao trong bộ nhớ: đặt lại trước, rồi mới xoá khoá đã lưu.
  useRecentListsStore.setState(useRecentListsStore.getInitialState(), true);
  useMatchRecordsStore.setState(useMatchRecordsStore.getInitialState(), true);
  useSuggestStore.setState(useSuggestStore.getInitialState(), true);
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(LOCAL_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // không đọc được kho lưu: dữ liệu còn lại chỉ nằm trên máy này, gỡ app sẽ xoá
  }
  clearAudioCache();
}

export async function deleteAccountAndSignOut(password: string): Promise<void> {
  await deleteAccount(password);
  await clearLocalData();
  // Token cũ đã vô hiệu cùng tài khoản: không gọi /auth/logout. app/_layout.tsx tự về đăng nhập.
  await useAuthStore.getState().signOut({ remote: false });
}
