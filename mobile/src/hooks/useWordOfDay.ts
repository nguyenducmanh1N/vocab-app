import { useQuery } from "@tanstack/react-query";

import { getWordFeed } from "@/api/notifications";

import { useWord } from "./useLibrary";

/**
 * Từ của ngày (Trang chủ): mục đầu của word-feed (PLAN.md 9.9, cùng nguồn với thông báo từ vựng),
 * rồi lấy đủ thông tin từ (IPA, phát âm, câu ví dụ) bằng GET /words/{id}.
 * Key bắt đầu bằng 'word-of-day' để kéo làm mới ở Trang chủ cập nhật lại.
 */
export function useWordOfDay() {
  const feed = useQuery({
    queryKey: ["word-of-day", "feed"],
    queryFn: ({ signal }) => getWordFeed(1, 1, signal),
    staleTime: 30 * 60 * 1000, // giữ ổn định trong phiên dùng app, không đổi sau mỗi câu trả lời
  });
  return useWord(feed.data?.items[0]?.word_id ?? ""); // cùng cache với màn Chi tiết từ
}
