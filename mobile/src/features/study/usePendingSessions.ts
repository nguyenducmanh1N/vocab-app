/** Số kết quả học còn chờ gửi (hàng đợi offline) của user hiện tại, và nút "Gửi ngay". */
import { useEffect, useState } from "react";

import { useAuthStore } from "@/stores/authStore";

import { studyQueue } from "./studyQueue";

export type PendingStatus = "idle" | "sending" | "failed";

export function usePendingSessions() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<PendingStatus>("idle");

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const refresh = () =>
      studyQueue
        .pendingCount(userId)
        .then((n) => {
          if (active) setCount(n);
        })
        .catch(() => undefined);
    refresh();
    const unsubscribe = studyQueue.subscribe(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [userId]);

  const flushNow = async () => {
    if (!userId) return;
    setStatus("sending");
    try {
      const { remaining } = await studyQueue.flush(userId);
      setStatus(remaining > 0 ? "failed" : "idle");
    } catch {
      setStatus("failed");
    }
  };

  return { count: userId ? count : 0, status, flushNow };
}
