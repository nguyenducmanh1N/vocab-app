/**
 * Hàng đợi offline cho POST /study/sessions (PLAN.md 10.2).
 *
 * Mọi payload, kể cả lô gửi bình thường, được ghi vào storage trước rồi mới gửi, và gửi
 * lần lượt theo thứ tự tạo (lô sau chờ lô trước) vì server chốt lần chấm đầu theo thứ tự đến
 * (9.4). Server chống ghi trùng theo client_answer_id nên gửi lại bao nhiêu lần cũng an toàn.
 */
import type { StudySessionIn, StudySessionOut } from "@/api/types";

export const PENDING_KEY = "vt.pending_sessions";

export type PendingItem = {
  id: string;
  userId: string;
  createdAt: number;
  payload: StudySessionIn;
};

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type QueueDeps = {
  storage: KeyValueStorage;
  send: (payload: StudySessionIn) => Promise<StudySessionOut>;
  onSent?: (result: StudySessionOut) => void;
  newId: () => string;
  now?: () => number;
};

export type FlushResult = {
  sent: { id: string; result: StudySessionOut }[];
  remaining: number;
};

/** Giữ mục để gửi lại: mất mạng, hết giờ, lỗi máy chủ, quá tải, phiên đăng nhập. */
export function isRetryable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return true; // lỗi không rõ: giữ lại cho chắc
  return status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
}

export function createOfflineQueue(deps: QueueDeps) {
  const now = deps.now ?? Date.now;

  // Báo cho giao diện (vd. "N kết quả chờ gửi") mỗi khi hàng đợi thay đổi.
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  // Khoá: các thao tác đọc-sửa-ghi storage chạy nối tiếp, không giẫm lên nhau.
  let lock: Promise<unknown> = Promise.resolve();
  function withLock<T>(task: () => Promise<T>): Promise<T> {
    const run = lock.then(task, task);
    lock = run.catch(() => undefined);
    return run;
  }

  async function read(): Promise<PendingItem[]> {
    const raw = await deps.storage.getItem(PENDING_KEY);
    if (!raw) return [];
    try {
      const items = JSON.parse(raw) as unknown;
      return Array.isArray(items) ? (items as PendingItem[]) : [];
    } catch {
      return []; // dữ liệu hỏng: bỏ, không chặn hàng đợi mãi
    }
  }

  const write = (items: PendingItem[]) => deps.storage.setItem(PENDING_KEY, JSON.stringify(items));

  async function remove(id: string): Promise<void> {
    await withLock(async () => write((await read()).filter((item) => item.id !== id)));
    notify();
  }

  /** Ghi vào storage; xong bước này thì tắt app cũng không mất payload. */
  async function enqueue(userId: string, payload: StudySessionIn): Promise<PendingItem> {
    const item = await withLock(async () => {
      const entry: PendingItem = { id: deps.newId(), userId, createdAt: now(), payload };
      await write([...(await read()), entry]);
      return entry;
    });
    notify();
    return item;
  }

  async function oldest(userId: string): Promise<PendingItem | undefined> {
    return withLock(async () => (await read()).find((item) => item.userId === userId));
  }

  async function pendingCount(userId: string): Promise<number> {
    return withLock(async () => (await read()).filter((item) => item.userId === userId).length);
  }

  // Chỉ một vòng gửi tại một thời điểm; gọi thêm khi đang gửi thì vòng đó chạy thêm một lượt.
  let running: Promise<FlushResult> | null = null;
  let again = false;

  async function drain(userId: string): Promise<FlushResult> {
    const sent: FlushResult["sent"] = [];
    let blocked = false;
    do {
      again = false;
      for (let item = await oldest(userId); item && !blocked; item = await oldest(userId)) {
        try {
          const result = await deps.send(item.payload);
          await remove(item.id);
          sent.push({ id: item.id, result });
          deps.onSent?.(result);
        } catch (error) {
          if (isRetryable(error)) {
            blocked = true; // giữ mục này và mọi mục sau để không lô nào vượt lô trước
          } else {
            await remove(item.id); // 4xx khác (payload hỏng…): gửi lại cũng vô ích
          }
        }
      }
    } while (again && !blocked);
    return { sent, remaining: await pendingCount(userId) };
  }

  /** Gửi các mục của user theo thứ tự tạo, dừng ở lỗi mạng đầu tiên. */
  function flush(userId: string): Promise<FlushResult> {
    if (running) {
      again = true;
      return running;
    }
    running = drain(userId).finally(() => {
      running = null;
    });
    return running;
  }

  /** Đưa vào hàng rồi gửi; trả kết quả của chính payload này, null nếu còn chờ mạng. */
  async function submit(userId: string, payload: StudySessionIn): Promise<StudySessionOut | null> {
    const item = await enqueue(userId, payload);
    const { sent } = await flush(userId);
    return sent.find((entry) => entry.id === item.id)?.result ?? null;
  }

  return { enqueue, flush, submit, pendingCount, subscribe };
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;
