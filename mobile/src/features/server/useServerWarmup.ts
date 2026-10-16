import { useCallback, useEffect, useRef, useState } from "react";

import { pingHealth } from "@/api/health";

import { HEALTH_TIMEOUT_MS, isServerWaking, retryDelayMs, SKIP_AFTER_MS } from "./warmup";

export type WarmupPhase = "checking" | "waking" | "ready";

/**
 * Gọi /health trước khi khởi động phiên đăng nhập. Máy chủ đang ngủ (mất mạng, hết giờ, 502–504)
 * thì chuyển sang "waking" và thử lại có giãn cách; sau 90 giây cho phép vào app không chờ.
 */
export function useServerWarmup() {
  const [phase, setPhase] = useState<WarmupPhase>("checking");
  const [attempt, setAttempt] = useState(0);
  const [canSkip, setCanSkip] = useState(false);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await pingHealth(HEALTH_TIMEOUT_MS);
      setPhase("ready");
    } catch (error) {
      if (!isServerWaking(error)) {
        setPhase("ready"); // lỗi khác (vd. thiếu cấu hình): để app hiện lỗi như bình thường
      } else {
        setPhase((current) => (current === "ready" ? current : "waking"));
        setAttempt((n) => n + 1);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Lần gọi đầu khi mở app (đưa sang tick sau: setState chỉ xảy ra khi có kết quả)
  useEffect(() => {
    const timer = setTimeout(check, 0);
    return () => clearTimeout(timer);
  }, [check]);

  // Thử lại theo giãn cách mỗi khi một lần gọi thất bại
  useEffect(() => {
    if (phase !== "waking" || attempt === 0) return;
    const timer = setTimeout(check, retryDelayMs(attempt));
    return () => clearTimeout(timer);
  }, [phase, attempt, check]);

  // Chờ quá lâu: cho vào app không chờ (dùng offline, hàng đợi gửi sau)
  useEffect(() => {
    if (phase !== "waking") return;
    const timer = setTimeout(() => setCanSkip(true), SKIP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return {
    phase,
    attempt,
    canSkip,
    retryNow: check,
    skip: () => setPhase("ready"),
  };
}
