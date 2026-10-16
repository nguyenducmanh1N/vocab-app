import { api } from "./client";
import type { CategoryCreate, CategoryOut, CategoryUpdate } from "./types";

export function getCategories(signal?: AbortSignal): Promise<CategoryOut[]> {
  return api.get<CategoryOut[]>("/categories", signal);
}

export function createCategory(body: CategoryCreate): Promise<CategoryOut> {
  return api.post<CategoryOut>("/categories", body);
}

export function updateCategory(id: string, body: CategoryUpdate): Promise<CategoryOut> {
  return api.patch<CategoryOut>(`/categories/${id}`, body);
}

export function deleteCategory(id: string): Promise<void> {
  return api.delete<void>(`/categories/${id}`);
}
