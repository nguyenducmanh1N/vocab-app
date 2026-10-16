/** Chúc mừng đạt mục tiêu ngày chỉ một lần mỗi ngày (theo giờ máy), mỗi user một khoá. */
import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (userId: string) => `vt.goal_celebrated.${userId}`;

export function localDateKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** true nếu hôm nay chưa chúc mừng; đồng thời ghi lại để lần sau không chúc nữa. */
export async function claimGoalCelebration(userId: string): Promise<boolean> {
  const today = localDateKey();
  try {
    if ((await AsyncStorage.getItem(key(userId))) === today) return false;
    await AsyncStorage.setItem(key(userId), today);
    return true;
  } catch {
    return false; // không đọc/ghi được thì thôi chúc mừng, tránh hiện lặp lại
  }
}
