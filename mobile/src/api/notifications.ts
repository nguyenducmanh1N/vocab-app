import { api } from "./client";
import { toQuery } from "./query";
import type { WordFeedOut } from "./types";

/** Từ cho thông báo đẩy từ vựng (PLAN.md 9.9): tối đa days × perDay (≤ 35) mục, theo ưu tiên. */
export function getWordFeed(days = 7, perDay = 3, signal?: AbortSignal): Promise<WordFeedOut> {
  return api.get<WordFeedOut>(`/notifications/word-feed${toQuery({ days, per_day: perDay })}`, signal);
}
