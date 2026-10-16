import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";

import { createCategory, deleteCategory, updateCategory } from "@/api/categories";
import { createList, deleteList, duplicateList, updateList } from "@/api/lists";
import type {
  CategoryCreate,
  CategoryUpdate,
  ListCreate,
  ListUpdate,
  Page,
  WordCreate,
  WordFilters,
  WordOut,
  WordUpdate,
} from "@/api/types";
import { createWord, deleteWord, updateWord } from "@/api/words";

// Làm mới theo bảng PLAN.md 10.2.
function refreshCategories(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["categories"] }),
    client.invalidateQueries({ queryKey: ["lists"] }), // xoá danh mục: list về "Chưa phân loại"
  ]);
}

function refreshLists(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["lists"] }),
    client.invalidateQueries({ queryKey: ["list"] }),
    client.invalidateQueries({ queryKey: ["categories"] }), // list_count
  ]);
}

function refreshWords(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["words"] }),
    client.invalidateQueries({ queryKey: ["word"] }),
    client.invalidateQueries({ queryKey: ["word-search"] }),
    client.invalidateQueries({ queryKey: ["lists"] }), // word_count, mastered_count, due_count
    client.invalidateQueries({ queryKey: ["list"] }),
  ]);
}

type WordPages = InfiniteData<Page<WordOut>, number>;

/**
 * Sửa/xoá một từ: vá thẳng các trang đã tải của danh sách từ thay vì invalidate. Infinite query
 * tải lại tuần tự mọi trang đã tải, list 2.000 từ cuộn hết là 40 request (P6.6).
 * `change` trả mảng từ mới của một trang trong list `listId`.
 */
function patchWordPages(client: QueryClient, change: (items: WordOut[], listId: string) => WordOut[]) {
  for (const [key, data] of client.getQueriesData<WordPages>({ queryKey: ["words"] })) {
    if (!data) continue;
    const listId = String(key[1]);
    const pages = data.pages.map((page) => ({ ...page, items: change(page.items, listId) }));
    const removed =
      data.pages.reduce((n, p) => n + p.items.length, 0) - pages.reduce((n, p) => n + p.items.length, 0);
    client.setQueryData<WordPages>(key, {
      ...data,
      pages: pages.map((page) => ({ ...page, total: page.total - removed })),
    });
  }
  // Danh sách đang lọc (mức thuộc, gắn sao) có thể không còn khớp: tải lại lần tới mở/quay lại.
  return client.invalidateQueries({
    queryKey: ["words"],
    predicate: (query) => Object.keys((query.queryKey[2] as WordFilters | undefined) ?? {}).length > 0,
    refetchType: "none",
  });
}

function refreshAroundWord(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["word"] }),
    client.invalidateQueries({ queryKey: ["word-search"] }),
    client.invalidateQueries({ queryKey: ["lists"] }), // word_count, mastered_count, due_count
    client.invalidateQueries({ queryKey: ["list"] }),
  ]);
}

function afterWordUpdate(client: QueryClient, updated: WordOut, moved: boolean) {
  if (moved) return refreshWords(client); // chuyển list: list đích cần tải lại (ít khi dùng)
  return Promise.all([
    patchWordPages(client, (items) => items.map((word) => (word.id === updated.id ? updated : word))),
    refreshAroundWord(client),
  ]);
}

function afterWordDelete(client: QueryClient, id: string) {
  return Promise.all([
    patchWordPages(client, (items) => items.filter((word) => word.id !== id)),
    refreshAroundWord(client),
  ]);
}

export function useCategoryMutations() {
  const client = useQueryClient();
  const onSuccess = () => refreshCategories(client);
  return {
    create: useMutation({ mutationFn: (body: CategoryCreate) => createCategory(body), onSuccess }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: CategoryUpdate }) => updateCategory(id, body),
      onSuccess,
    }),
    remove: useMutation({ mutationFn: (id: string) => deleteCategory(id), onSuccess }),
  };
}

export function useListMutations() {
  const client = useQueryClient();
  const onSuccess = () => refreshLists(client);
  return {
    create: useMutation({ mutationFn: (body: ListCreate) => createList(body), onSuccess }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: ListUpdate }) => updateList(id, body),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteList(id),
      onSuccess: () => Promise.all([refreshLists(client), refreshWords(client)]),
    }),
    duplicate: useMutation({ mutationFn: (id: string) => duplicateList(id), onSuccess }),
  };
}

export function useWordMutations() {
  const client = useQueryClient();
  const onSuccess = () => refreshWords(client);
  return {
    create: useMutation({
      mutationFn: ({
        listId,
        body,
        allowDuplicate,
      }: {
        listId: string;
        body: WordCreate;
        allowDuplicate?: boolean;
      }) => createWord(listId, body, allowDuplicate),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: WordUpdate }) => updateWord(id, body),
      // Màn Sửa từ chỉ gửi list_id khi chuyển sang list khác.
      onSuccess: (updated, { body }) => afterWordUpdate(client, updated, body.list_id !== undefined),
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteWord(id),
      onSuccess: (_data, id) => afterWordDelete(client, id),
    }),
  };
}
