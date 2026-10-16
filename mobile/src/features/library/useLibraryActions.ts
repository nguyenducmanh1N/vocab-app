import { router } from "expo-router";

import type { CategoryOut, ListOut } from "@/api/types";
import { useCategories } from "@/hooks/useLibrary";
import { useCategoryMutations, useListMutations } from "@/hooks/useLibraryMutations";
import { categoryPalette } from "@/theme/tokens";

import { confirmDestructive, pickOption, promptText, showError } from "./dialogs";

/** Các thao tác tạo/sửa/xoá danh mục và list, dùng chung ở tab Thư viện và các màn chi tiết. */
export function useLibraryActions() {
  const categories = useCategories();
  const categoryMutations = useCategoryMutations();
  const listMutations = useListMutations();

  async function createCategory(): Promise<void> {
    const name = await promptText("Danh mục mới", "Ví dụ: Du lịch, Công việc");
    if (!name) return;
    const color = categoryPalette[(categories.data?.length ?? 0) % categoryPalette.length];
    try {
      const category = await categoryMutations.create.mutateAsync({ name, color });
      router.push({ pathname: "/category/[id]", params: { id: category.id } });
    } catch (err) {
      showError(err, "Không tạo được danh mục");
    }
  }

  async function createList(categoryId: string | null = null): Promise<void> {
    const name = await promptText("List mới", "Ví dụ: Ở sân bay");
    if (!name) return;
    try {
      const list = await listMutations.create.mutateAsync({ name, category_id: categoryId });
      router.push({ pathname: "/list/[id]", params: { id: list.id } });
    } catch (err) {
      showError(err, "Không tạo được list");
    }
  }

  /** Nhân bản list (không chép tiến độ) rồi mở bản sao; quay lại là về list gốc. */
  async function duplicateList(list: ListOut): Promise<void> {
    try {
      const copy = await listMutations.duplicate.mutateAsync(list.id);
      router.push({ pathname: "/list/[id]", params: { id: copy.id } });
    } catch (err) {
      showError(err, "Không nhân bản được list");
    }
  }

  async function categoryMenu(category: CategoryOut): Promise<boolean> {
    const choice = await pickOption(
      category.name,
      ["Đổi tên", category.is_pinned ? "Bỏ ghim" : "Ghim lên đầu", "Xoá danh mục"],
      2,
    );
    try {
      if (choice === 0) {
        const name = await promptText("Đổi tên danh mục", undefined, category.name);
        if (name && name !== category.name) {
          await categoryMutations.update.mutateAsync({ id: category.id, body: { name } });
        }
      } else if (choice === 1) {
        await categoryMutations.update.mutateAsync({
          id: category.id,
          body: { is_pinned: !category.is_pinned },
        });
      } else if (choice === 2) {
        const ok = await confirmDestructive(
          `Xoá "${category.name}"?`,
          "Các list bên trong được giữ lại và chuyển về Chưa phân loại.",
        );
        if (ok) {
          await categoryMutations.remove.mutateAsync(category.id);
          return true; // màn chi tiết nên quay lại
        }
      }
    } catch (err) {
      showError(err);
    }
    return false;
  }

  async function moveListToCategory(list: ListOut): Promise<void> {
    const options = categories.data ?? [];
    const labels = ["Chưa phân loại", ...options.map((c) => c.name)];
    const choice = await pickOption("Chuyển list sang danh mục", labels);
    if (choice === null) return;
    const categoryId = choice === 0 ? null : options[choice - 1].id;
    if (categoryId === list.category_id) return;
    try {
      await listMutations.update.mutateAsync({ id: list.id, body: { category_id: categoryId } });
    } catch (err) {
      showError(err);
    }
  }

  async function listMenu(list: ListOut): Promise<boolean> {
    const choice = await pickOption(list.name, ["Đổi tên", "Chuyển danh mục", "Xoá list"], 2);
    try {
      if (choice === 0) {
        const name = await promptText("Đổi tên list", undefined, list.name);
        if (name && name !== list.name) {
          await listMutations.update.mutateAsync({ id: list.id, body: { name } });
        }
      } else if (choice === 1) {
        await moveListToCategory(list);
      } else if (choice === 2) {
        const ok = await confirmDestructive(
          `Xoá "${list.name}"?`,
          `${list.word_count} từ và tiến độ ôn trong list sẽ bị xoá vĩnh viễn.`,
        );
        if (ok) {
          await listMutations.remove.mutateAsync(list.id);
          return true;
        }
      }
    } catch (err) {
      showError(err);
    }
    return false;
  }

  return {
    createCategory,
    createList,
    duplicateList,
    duplicating: listMutations.duplicate.isPending,
    categoryMenu,
    listMenu,
  };
}
