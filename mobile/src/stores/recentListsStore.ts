import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const MAX_RECENT = 5;

type RecentListsState = {
  /** id list học gần đây, mới nhất trước. */
  ids: string[];
  touch: (listId: string) => void;
};

/**
 * List vừa học (ghi khi kết thúc một phiên học theo list), để Trang chủ hiện "List học gần đây".
 * Lưu trên máy: API chưa có "lần học cuối" của list, chỉ cần cho tiện, không cần chính xác tuyệt đối.
 */
export const useRecentListsStore = create<RecentListsState>()(
  persist(
    (set) => ({
      ids: [],
      touch: (listId) =>
        set((state) => ({
          ids: [listId, ...state.ids.filter((id) => id !== listId)].slice(0, MAX_RECENT),
        })),
    }),
    { name: "vt.recent_lists", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
