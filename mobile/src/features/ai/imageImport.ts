import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

const MAX_WIDTH = 1280; // đủ rõ để đọc chữ, ảnh gửi đi nhỏ (~200–400 KB)

export const IMAGE_TOPIC_PREFIX = "Từ trong ảnh";

/**
 * Chụp hoặc chọn ảnh, thu nhỏ rồi trả base64 JPEG; null nếu người dùng huỷ hoặc không cấp quyền.
 */
export async function pickImageBase64(source: "camera" | "library"): Promise<string | null> {
  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("PERMISSION_DENIED");

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  return saved.base64 ?? null;
}

export function imageTopic(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${IMAGE_TOPIC_PREFIX} ${pad(now.getDate())}/${pad(now.getMonth() + 1)}`;
}
