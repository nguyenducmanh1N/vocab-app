import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { getCategories } from "@/api/categories";
import { getList, getLists } from "@/api/lists";
import type { ListFilters, WordFilters } from "@/api/types";
import { getWord, getWords, searchWords } from "@/api/words";

// Query key theo PLAN.md 10.2.
export const keys = {
  categories: ["categories"] as const,
  lists: (filters: ListFilters = {}) => ["lists", filters] as const,
  list: (id: string) => ["list", id] as const,
  words: (listId: string, filters: WordFilters = {}) => ["words", listId, filters] as const,
  word: (id: string) => ["word", id] as const,
  wordSearch: (q: string) => ["word-search", q] as const,
};

export function useCategories() {
  return useQuery({ queryKey: keys.categories, queryFn: ({ signal }) => getCategories(signal) });
}

export function useLists(filters: ListFilters = {}) {
  return useQuery({
    queryKey: keys.lists(filters),
    queryFn: ({ signal }) => getLists(filters, signal),
  });
}

export function useList(id: string) {
  return useQuery({
    queryKey: keys.list(id),
    queryFn: ({ signal }) => getList(id, signal),
    enabled: Boolean(id),
  });
}

/** Từ trong list, tải thêm từng trang 50 từ khi cuộn tới cuối. */
export function useWords(listId: string, filters: WordFilters = {}) {
  return useInfiniteQuery({
    queryKey: keys.words(listId, filters),
    queryFn: ({ pageParam, signal }) => getWords(listId, filters, pageParam, signal),
    initialPageParam: 0,
    // Offset = số từ đang có trong cache, không phải số trang × 50: xoá một từ thì cache được vá
    // tại chỗ (useLibraryMutations), server cũng dồn lên một, nên vẫn không sót từ nào.
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0);
      return loaded < lastPage.total && lastPage.items.length > 0 ? loaded : undefined;
    },
  });
}

export function useWord(id: string) {
  return useQuery({
    queryKey: keys.word(id),
    queryFn: ({ signal }) => getWord(id, signal),
    enabled: Boolean(id),
  });
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Tìm từ trong mọi list (GET /words/search); chờ 300 ms sau khi ngừng gõ. */
export function useWordSearch(q: string) {
  const term = useDebounced(q.trim(), 300);
  return useQuery({
    queryKey: keys.wordSearch(term),
    queryFn: ({ signal }) => searchWords(term, signal),
    enabled: term.length > 0,
  });
}
