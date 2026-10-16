import { api, request } from "./client";
import { toQuery } from "./query";
import type { BulkOut, ListCreate, ListFilters, ListOut, ListUpdate, WordCreate } from "./types";

export function getLists(filters: ListFilters = {}, signal?: AbortSignal): Promise<ListOut[]> {
  return api.get<ListOut[]>(`/lists${toQuery(filters)}`, signal);
}

export function getList(id: string, signal?: AbortSignal): Promise<ListOut> {
  return api.get<ListOut>(`/lists/${id}`, signal);
}

export function createList(body: ListCreate): Promise<ListOut> {
  return api.post<ListOut>("/lists", body);
}

export function updateList(id: string, body: ListUpdate): Promise<ListOut> {
  return api.patch<ListOut>(`/lists/${id}`, body);
}

export function deleteList(id: string): Promise<void> {
  return api.delete<void>(`/lists/${id}`);
}

/** Thêm hàng loạt (tối đa 100 từ/lô); từ trùng trong list bị bỏ qua. */
export function bulkCreateWords(listId: string, words: WordCreate[]): Promise<BulkOut> {
  return api.post<BulkOut>(`/lists/${listId}/words/bulk`, { words });
}

/** Bản sao list và các từ, không chép tiến độ (PLAN.md 8.3). */
export function duplicateList(id: string): Promise<ListOut> {
  return api.post<ListOut>(`/lists/${id}/duplicate`);
}

/** Nội dung CSV (UTF-8 có BOM) của list do server tạo. */
export function exportListCsv(id: string): Promise<string> {
  return request<string>(`/lists/${id}/export`, { responseType: "text" });
}
