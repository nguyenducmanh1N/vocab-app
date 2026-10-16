/** Ghi CSV vào cache rồi mở bảng chia sẻ của iOS (Lưu vào Tệp, AirDrop, Mail…) bằng expo-sharing. */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { ApiError } from "@/api/client";

const BOM = "﻿";

export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "list";
}

export async function shareCsv(csv: string, name: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new ApiError(0, "SHARE_UNAVAILABLE", "Máy này không mở được bảng chia sẻ file.");
  }
  const file = new File(Paths.cache, `${safeFileName(name)}.csv`);
  if (file.exists) file.delete();
  file.create();
  // Đọc text có thể đã bỏ BOM của server: luôn gắn lại để Excel đọc đúng tiếng Việt.
  file.write(BOM + csv.replace(/^﻿/, ""));
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/csv",
    UTI: "public.comma-separated-values-text",
    dialogTitle: name,
  });
}
