import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { postStudySession } from "@/api/study";
import type { StudySessionIn, StudySessionOut } from "@/api/types";

import { createOfflineQueue, PENDING_KEY, type PendingItem } from "../offlineQueue";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
// Có access token sẵn, không đụng SecureStore.
jest.mock("@/api/tokenStorage", () => ({
  loadTokens: async () => ({ access: "access-token", refresh: "refresh-token" }),
  saveTokens: async () => undefined,
  clearTokens: async () => undefined,
}));

const USER = "user-a";

function payload(n: number): StudySessionIn {
  return {
    client_session_id: "session-1",
    list_id: null,
    mode: "flashcard",
    started_at: "2026-10-15T03:00:00.000Z",
    finished: false,
    ended_at: null,
    answers: [
      {
        client_answer_id: `answer-${n}`,
        word_id: `word-${n}`,
        quality: 4,
        is_correct: true,
        is_first_attempt: true,
        response_ms: 1000,
        answered_at: "2026-10-15T03:00:01.000Z",
      },
    ],
  };
}

const OUT: StudySessionOut = {
  session_id: "server-session",
  accepted: 1,
  duplicates: 0,
  progress: [],
  today: { cards_done: 1, goal: 20, goal_met: false, streak_current: 0 },
};

type Deferred = { resolve: () => void; reject: (error: Error) => void };

/** fetch giả: ghi lại body đã gửi; mỗi lần gọi tuỳ chế độ trả ngay hoặc treo tới khi giải quyết. */
class FakeServer {
  bodies: StudySessionIn[] = [];
  inFlight = 0;
  maxInFlight = 0;
  mode: "ok" | "offline" | "manual" | { status: number } = "ok";
  waiting: Deferred[] = [];

  readonly fetch = jest.fn(async (_url: unknown, init?: { body?: unknown }) => {
    this.bodies.push(JSON.parse(String(init?.body)) as StudySessionIn);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const mode = this.mode;
      if (mode === "offline") throw new TypeError("Network request failed");
      if (mode === "manual") {
        await new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
      }
      const status = typeof mode === "object" ? mode.status : 200;
      const body =
        status === 200 ? OUT : { error: { code: "X", message: "lỗi", details: null } };
      return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
    } finally {
      this.inFlight--;
    }
  });

  sentAnswerIds(): string[] {
    return this.bodies.map((b) => b.answers[0]?.client_answer_id ?? "");
  }
}

let server: FakeServer;
let ids = 0;

function makeQueue(onSent?: (out: StudySessionOut) => void) {
  return createOfflineQueue({
    storage: AsyncStorage,
    send: postStudySession,
    newId: () => `item-${++ids}`,
    onSent,
  });
}

async function stored(): Promise<PendingItem[]> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  return raw ? (JSON.parse(raw) as PendingItem[]) : [];
}

/** Chờ các Promise đang dở chạy tiếp (fetch giả, AsyncStorage giả đều bất đồng bộ). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  await AsyncStorage.clear();
  server = new FakeServer();
  global.fetch = server.fetch as unknown as typeof fetch;
});

afterEach(() => {
  server.waiting.forEach((d) => d.resolve()); // không để request treo sang test sau
});

describe("offlineQueue", () => {
  it("giữ thứ tự tạo khi gửi lại sau lúc offline", async () => {
    const queue = makeQueue();
    server.mode = "offline";
    for (const n of [1, 2, 3]) expect(await queue.submit(USER, payload(n))).toBeNull();
    expect((await stored()).map((i) => i.payload.answers[0].client_answer_id)).toEqual([
      "answer-1",
      "answer-2",
      "answer-3",
    ]);

    server.mode = "ok";
    server.bodies = [];
    const { sent, remaining } = await queue.flush(USER);

    expect(server.sentAnswerIds()).toEqual(["answer-1", "answer-2", "answer-3"]);
    expect(sent).toHaveLength(3);
    expect(remaining).toBe(0);
    expect(await stored()).toEqual([]);
  });

  it("không gửi song song: lô sau chỉ bắt đầu khi lô trước xong", async () => {
    const queue = makeQueue();
    server.mode = "manual";
    const results = [1, 2, 3].map((n) => queue.submit(USER, payload(n)));
    queue.flush(USER);
    queue.flush(USER);
    await settle();

    for (let i = 1; i <= 3; i++) {
      await settle();
      expect(server.inFlight).toBe(1);
      expect(server.bodies).toHaveLength(i); // lô i+1 chưa được gửi
      server.waiting.shift()!.resolve();
      await settle();
    }

    expect(server.maxInFlight).toBe(1);
    expect(server.sentAnswerIds()).toEqual(["answer-1", "answer-2", "answer-3"]);
    expect(await Promise.all(results)).toEqual([OUT, OUT, OUT]);
    expect(await stored()).toEqual([]);
  });

  it("lỗi mạng: dừng ở lô đầu, giữ cả hàng; lần flush sau gửi lại đủ và đúng thứ tự", async () => {
    const queue = makeQueue();
    await queue.enqueue(USER, payload(1));
    await queue.enqueue(USER, payload(2));

    server.mode = "offline";
    const first = await queue.flush(USER);
    expect(first).toEqual({ sent: [], remaining: 2 });
    expect(server.sentAnswerIds()).toEqual(["answer-1"]); // lô 2 không được thử khi lô 1 lỗi
    expect(await stored()).toHaveLength(2);

    server.mode = "ok";
    server.bodies = [];
    const second = await queue.flush(USER);
    expect(second.remaining).toBe(0);
    expect(server.sentAnswerIds()).toEqual(["answer-1", "answer-2"]);
  });

  it("lỗi 5xx giữ mục; lỗi 4xx (payload hỏng) bỏ mục rồi gửi tiếp", async () => {
    const queue = makeQueue();
    await queue.enqueue(USER, payload(1));
    await queue.enqueue(USER, payload(2));

    server.mode = { status: 503 };
    expect((await queue.flush(USER)).remaining).toBe(2);

    server.mode = { status: 422 };
    const result = await queue.flush(USER);
    expect(result).toEqual({ sent: [], remaining: 0 });
    expect(server.sentAnswerIds()).toEqual(["answer-1", "answer-1", "answer-2"]);
  });

  it("payload không mất khi app bị tắt trước lúc gửi", async () => {
    server.mode = "offline";
    const beforeKill = makeQueue();
    await beforeKill.enqueue(USER, payload(1)); // đã ghi xuống máy, chưa gửi được

    // Mở lại app: hàng đợi mới đọc lại từ storage.
    server.mode = "ok";
    const afterRestart = makeQueue();
    expect(await afterRestart.pendingCount(USER)).toBe(1);
    const { sent } = await afterRestart.flush(USER);

    expect(sent.map((s) => s.result)).toEqual([OUT]);
    expect(server.sentAnswerIds()).toEqual(["answer-1"]);
    expect(await stored()).toEqual([]);
  });

  it("app bị tắt khi request đang gửi: mục vẫn còn và được gửi lại (server chống trùng)", async () => {
    server.mode = "manual";
    const beforeKill = makeQueue();
    await beforeKill.enqueue(USER, payload(1));
    beforeKill.flush(USER); // request treo, app bị tắt trước khi có phản hồi
    await settle();
    expect(server.inFlight).toBe(1);
    expect(await stored()).toHaveLength(1);

    server.mode = "ok";
    const afterRestart = makeQueue();
    await afterRestart.flush(USER);

    expect(server.sentAnswerIds()).toEqual(["answer-1", "answer-1"]); // gửi lại cùng client_answer_id
    expect(await stored()).toEqual([]);

    // Request cũ có phản hồi muộn: không gửi thêm gì, hàng vẫn rỗng.
    server.waiting.shift()!.resolve();
    await settle();
    await settle();
    expect(server.bodies).toHaveLength(2);
    expect(await stored()).toEqual([]);
  });

  it("không gửi mục của user khác bằng phiên đăng nhập hiện tại", async () => {
    server.mode = "offline";
    const queue = makeQueue();
    await queue.enqueue("user-b", payload(9));
    await queue.enqueue(USER, payload(1));

    server.mode = "ok";
    await queue.flush(USER);

    expect(server.sentAnswerIds()).toEqual(["answer-1"]);
    expect((await stored()).map((i) => i.userId)).toEqual(["user-b"]);
  });

  it("gọi onSent cho mỗi lô gửi thành công, kèm access token", async () => {
    const onSent = jest.fn();
    const queue = makeQueue(onSent);
    await queue.submit(USER, payload(1));
    await queue.submit(USER, payload(2));

    expect(onSent).toHaveBeenCalledTimes(2);
    const init = server.fetch.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer access-token");
  });

  it("báo cho người nghe khi thêm vào hàng và khi gửi xong; huỷ đăng ký thì thôi", async () => {
    const queue = makeQueue();
    const counts: number[] = [];
    const unsubscribe = queue.subscribe(() => {
      queue.pendingCount(USER).then((n) => counts.push(n));
    });

    server.mode = "offline";
    await queue.enqueue(USER, payload(1));
    await settle();
    expect(counts).toEqual([1]);

    server.mode = "ok";
    await queue.flush(USER);
    await settle();
    expect(counts).toEqual([1, 0]);

    unsubscribe();
    await queue.enqueue(USER, payload(2));
    await settle();
    expect(counts).toEqual([1, 0]);
  });
});
