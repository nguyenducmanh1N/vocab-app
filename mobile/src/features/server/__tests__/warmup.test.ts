import { describe, expect, it } from "@jest/globals";

import { ApiError } from "@/api/client";

import { isServerWaking, retryDelayMs } from "../warmup";

describe("retryDelayMs", () => {
  const mid = () => 0.5; // không lệch

  it("giãn cách 2 → 4 → 8 → 15 giây rồi giữ 15 giây", () => {
    expect([1, 2, 3, 4, 5, 10].map((n) => retryDelayMs(n, mid))).toEqual([
      2000, 4000, 8000, 15000, 15000, 15000,
    ]);
  });

  it("dao động trong ±20%", () => {
    expect(retryDelayMs(4, () => 0)).toBe(12000);
    expect(retryDelayMs(4, () => 0.999999)).toBe(18000);
    expect(retryDelayMs(0, mid)).toBe(2000); // giá trị lạ vẫn an toàn
  });
});

describe("isServerWaking", () => {
  it.each([
    [new ApiError(0, "NETWORK", "mất mạng"), true],
    [new ApiError(0, "TIMEOUT", "hết giờ"), true],
    [new ApiError(502, "HTTP_502", "bad gateway"), true],
    [new ApiError(503, "HTTP_503", "đang khởi động"), true],
    [new ApiError(504, "HTTP_504", "gateway timeout"), true],
    [new ApiError(0, "CONFIG_ERROR", "thiếu URL"), false],
    [new ApiError(500, "INTERNAL_ERROR", "lỗi"), false],
    [new ApiError(401, "TOKEN_INVALID", "token"), false],
    [new TypeError("Network request failed"), true],
  ])("%s → %s", (error, expected) => {
    expect(isServerWaking(error)).toBe(expected);
  });
});
