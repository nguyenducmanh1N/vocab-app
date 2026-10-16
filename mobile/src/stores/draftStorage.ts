import AsyncStorage from "@react-native-async-storage/async-storage";

/** Nháp lưu tạm trên máy (PLAN.md 10.2 dùng AsyncStorage): thoát giữa chừng không mất việc đang làm. */
const PREFIX = "vt.draft.";

export async function loadDraft(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export async function saveDraft(key: string, value: string): Promise<void> {
  try {
    if (value.trim()) await AsyncStorage.setItem(PREFIX + key, value);
    else await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    // không lưu được nháp thì thôi
  }
}

export async function clearDraft(key: string): Promise<void> {
  await saveDraft(key, "");
}
