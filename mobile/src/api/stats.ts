import { api } from "./client";
import { toQuery } from "./query";
import type { DailyStat, HardWord, StatsOverview } from "./types";

export function getStatsOverview(signal?: AbortSignal): Promise<StatsOverview> {
  return api.get<StatsOverview>("/stats/overview", signal);
}

/** Đủ `days` ngày tới hôm nay (giờ của user), ngày không học trả 0. */
export function getStatsDaily(days = 30, signal?: AbortSignal): Promise<DailyStat[]> {
  return api.get<DailyStat[]>(`/stats/daily${toQuery({ days })}`, signal);
}

export function getHardWords(limit = 10, signal?: AbortSignal): Promise<HardWord[]> {
  return api.get<HardWord[]>(`/stats/hard-words${toQuery({ limit })}`, signal);
}
