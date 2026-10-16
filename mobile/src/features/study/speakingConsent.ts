/**
 * Đồng ý gửi bản ghi luyện nói tới Gemini (PLAN.md 9.11). Lưu theo từng máy, không vào
 * users.settings; hỏi lại nếu đọc không được.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";

const KEY = "vt.speaking_ai_consent";

export const GEMINI_FREE_TIER_NOTE =
  "Bản ghi được gửi tới Gemini (gói miễn phí); Google có thể dùng nội dung này để cải thiện sản phẩm. Máy chủ xoá bản ghi ngay sau khi nhận xét.";

function askConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Gửi bản ghi cho AI nhận xét?",
      "Bản ghi giọng nói của bạn sẽ được gửi lên máy chủ rồi tới Google Gemini (gói miễn phí). " +
        "Google có thể dùng nội dung gửi lên gói miễn phí để cải thiện sản phẩm của họ.\n\n" +
        "Máy chủ của app không lưu bản ghi: xoá ngay sau khi có nhận xét. " +
        "Nhận xét của AI chỉ mang tính tham khảo.",
      [
        { text: "Huỷ", style: "cancel", onPress: () => resolve(false) },
        { text: "Đồng ý và gửi", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** true nếu đã đồng ý trên máy này, hoặc vừa bấm "Đồng ý và gửi". */
export async function ensureSpeakingConsent(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(KEY)) === "1") return true;
  } catch {
    // không đọc được thì hỏi lại
  }
  const agreed = await askConsent();
  if (agreed) await AsyncStorage.setItem(KEY, "1").catch(() => undefined);
  return agreed;
}
