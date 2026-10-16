import { useQuery } from "@tanstack/react-query";

import { getHardWords, getStatsDaily, getStatsOverview } from "@/api/stats";

// Key bắt đầu bằng 'stats' (10.2): hàng đợi kết quả học làm mới cả nhóm sau mỗi lô gửi.
export function useStatsOverview() {
  return useQuery({
    queryKey: ["stats", "overview"],
    queryFn: ({ signal }) => getStatsOverview(signal),
  });
}

export function useStatsDaily(days = 30) {
  return useQuery({
    queryKey: ["stats", "daily", days],
    queryFn: ({ signal }) => getStatsDaily(days, signal),
  });
}

export function useHardWords(limit = 10) {
  return useQuery({
    queryKey: ["stats", "hard-words", limit],
    queryFn: ({ signal }) => getHardWords(limit, signal),
  });
}
