import { api, request } from "./client";
import { toQuery } from "./query";
import type { Page, WordCreate, WordFilters, WordOut, WordSearchOut, WordUpdate } from "./types";

export const WORDS_PAGE_SIZE = 50;

export function getWords(
  listId: string,
  filters: WordFilters,
  offset: number,
  signal?: AbortSignal,
): Promise<Page<WordOut>> {
  const query = toQuery({ ...filters, limit: WORDS_PAGE_SIZE, offset });
  return api.get<Page<WordOut>>(`/lists/${listId}/words${query}`, signal);
}

export function getWord(id: string, signal?: AbortSignal): Promise<WordOut> {
  return api.get<WordOut>(`/words/${id}`, signal);
}

export function createWord(
  listId: string,
  body: WordCreate,
  allowDuplicate = false,
): Promise<WordOut> {
  const query = toQuery({ allow_duplicate: allowDuplicate || undefined });
  return request<WordOut>(`/lists/${listId}/words${query}`, { method: "POST", body });
}

export function updateWord(id: string, body: WordUpdate): Promise<WordOut> {
  return api.patch<WordOut>(`/words/${id}`, body);
}

export function deleteWord(id: string): Promise<void> {
  return api.delete<void>(`/words/${id}`);
}

export function searchWords(q: string, signal?: AbortSignal): Promise<WordSearchOut[]> {
  return api.get<WordSearchOut[]>(`/words/search${toQuery({ q })}`, signal);
}
