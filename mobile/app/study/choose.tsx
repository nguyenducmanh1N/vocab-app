import { router, useLocalSearchParams } from "expo-router";

import type { StudyMode } from "@/api/types";
import { StudyModeSheet } from "@/features/study/ui/StudyModeSheet";

/**
 * Popup chọn cách học cho một list (transparentModal).
 * Chọn xong thì đóng popup rồi mới mở màn học trên stack gốc: nếu replace ngay popup, màn học
 * kế thừa kiểu modal (hiện dạng tấm, bàn phím che nút "Kiểm tra").
 */
export default function ChooseStudyModeScreen() {
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const start = (mode: StudyMode) => {
    router.back();
    router.push({ pathname: "/study/[mode]", params: { mode, listId } });
  };
  return <StudyModeSheet onClose={() => router.back()} onSelect={start} />;
}
