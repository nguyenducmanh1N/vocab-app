import { useEffect, useRef, useState } from "react";

import { playWord } from "@/services/audio";

import { hapticResult } from "./feedback";
import type { StudyCard } from "../types";

const AUTO_NEXT_MS = 1000; // trả lời đúng thì tự sang câu sau 1 giây

/**
 * Trạng thái sau khi trả lời: phát âm, rung theo kết quả; đúng thì tự sang câu tiếp,
 * sai thì chờ người dùng bấm "Tiếp tục" để kịp xem đáp án.
 */
export function useAfterAnswer(card: StudyCard, onNext: () => void) {
  const [result, setResult] = useState<boolean | null>(null);
  // onNext của màn cha đổi mỗi lần render: giữ bản mới nhất để hẹn giờ không bị đặt lại.
  const nextRef = useRef(onNext);
  useEffect(() => {
    nextRef.current = onNext;
  });

  const reveal = (correct: boolean) => {
    setResult(correct);
    hapticResult(correct);
    playWord(card.term, card.audio_url);
  };

  useEffect(() => {
    if (result !== true) return;
    const timer = setTimeout(() => nextRef.current(), AUTO_NEXT_MS);
    return () => clearTimeout(timer);
  }, [result]);

  return { result, reveal };
}
