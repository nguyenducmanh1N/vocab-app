import { Directory, File, Paths } from "expo-file-system";

/**
 * Lưu file phát âm (mp3) vào thư mục cache của app: lần sau phát ngay, kể cả khi offline
 * hoặc máy chủ từ điển sập. Thư mục cache không sao lưu lên iCloud; iOS có thể tự dọn khi
 * máy sắp đầy (khi đó tải lại lúc cần). Gỡ app thì iOS xoá cùng app.
 */
const MAX_BYTES = 50 * 1024 * 1024; // giới hạn tổng; vượt thì xoá file cũ nhất

const directory = new Directory(Paths.cache, "pronunciations");
const inflight = new Map<string, Promise<void>>();

/** Tên file ổn định theo URL (băm djb2) + đuôi gốc. */
function fileFor(url: string): File {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
  const ext = url.match(/\.(mp3|ogg|wav|m4a)(?:\?|$)/i)?.[1] ?? "mp3";
  return new File(directory, `${hash.toString(36)}.${ext.toLowerCase()}`);
}

/** URI file đã lưu trên máy, hoặc null nếu chưa có. */
export function cachedUri(url: string): string | null {
  try {
    const file = fileFor(url);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

function listFiles(): File[] {
  if (!directory.exists) return [];
  return directory.list().filter((item): item is File => item instanceof File);
}

/** Xoá file cũ nhất cho tới khi tổng dung lượng ≤ giới hạn. */
function enforceLimit(): void {
  const files = listFiles().map((file) => ({
    file,
    size: file.size ?? 0,
    time: file.info().modificationTime ?? 0,
  }));
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files.sort((a, b) => a.time - b.time)) {
    if (total <= MAX_BYTES) break;
    f.file.delete();
    total -= f.size;
  }
}

/** Tải về nền (không chặn việc phát); lỗi thì bỏ qua, lần sau thử lại. */
export function cacheInBackground(url: string): void {
  if (cachedUri(url) || inflight.has(url)) return;
  const task = (async () => {
    try {
      if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
      await File.downloadFileAsync(url, fileFor(url), { idempotent: true });
      enforceLimit();
    } catch {
      // máy chủ lỗi hoặc offline: lần sau thử lại
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, task);
}

/** Tổng dung lượng file phát âm đã lưu (byte). */
export function cacheSize(): number {
  try {
    return listFiles().reduce((sum, file) => sum + (file.size ?? 0), 0);
  } catch {
    return 0;
  }
}

/** Xoá toàn bộ file phát âm đã lưu. */
export function clearAudioCache(): void {
  if (directory.exists) directory.delete();
}
