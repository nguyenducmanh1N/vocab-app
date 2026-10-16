/** Hàng đợi offline dùng trong app: AsyncStorage + POST /study/sessions (PLAN.md 10.2). */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

import { queryClient } from "@/api/queryClient";
import { postStudySession } from "@/api/study";

import { createOfflineQueue } from "./offlineQueue";

// Gửi kết quả học thành công → làm mới các dữ liệu phụ thuộc (bảng query key ở 10.2).
const AFFECTED_KEYS = ["lists", "list", "word", "word-search", "study-queue", "stats"];

export const studyQueue = createOfflineQueue({
  storage: AsyncStorage,
  send: postStudySession,
  newId: Crypto.randomUUID,
  onSent: () => {
    for (const key of AFFECTED_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
    // Danh sách từ (infinite, có thể tới 40 trang): chỉ đánh dấu cũ; Chi tiết list tải lại một lần
    // khi được mở lại, thay vì sau mỗi lô 10 câu trả lời (P6.6).
    queryClient.invalidateQueries({ queryKey: ["words"], refetchType: "none" });
  },
});
