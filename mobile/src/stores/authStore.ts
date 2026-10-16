import { create } from "zustand";

import { logout } from "@/api/auth";
import { ApiError, setAuthFailureHandler } from "@/api/client";
import { getMe } from "@/api/me";
import { queryClient } from "@/api/queryClient";
import { clearTokens, loadTokens, saveTokens } from "@/api/tokenStorage";
import type { AuthOut, UserOut } from "@/api/types";

import { useSettingsStore } from "./settingsStore";

type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthState = {
  user: UserOut | null;
  status: AuthStatus;
  /** Lúc mở app: đọc token → GET /me. Gọi một lần ở app/_layout.tsx. */
  bootstrap: () => Promise<void>;
  signIn: (auth: AuthOut) => Promise<void>;
  /** remote = true: gọi /auth/logout để thu hồi refresh token trên server. */
  signOut: (options?: { remote?: boolean }) => Promise<void>;
  setUser: (user: UserOut) => void;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  status: "loading",

  bootstrap: async () => {
    const tokens = await loadTokens();
    if (!tokens) {
      set({ status: "signedOut", user: null });
      return;
    }
    try {
      const user = await getMe(); // tự refresh nếu access token đã hết hạn
      useSettingsStore.getState().setSettings(user.settings);
      set({ status: "signedIn", user });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await get().signOut();
      } else {
        // Mất mạng lúc mở app: giữ phiên, lần gọi API sau sẽ tải lại.
        set({ status: "signedIn", user: null });
      }
    }
  },

  signIn: async ({ user, tokens }) => {
    await saveTokens(tokens);
    queryClient.clear();
    useSettingsStore.getState().setSettings(user.settings);
    set({ status: "signedIn", user });
  },

  signOut: async ({ remote = false } = {}) => {
    if (remote) {
      const tokens = await loadTokens();
      if (tokens) await logout(tokens.refresh).catch(() => undefined);
    }
    await clearTokens();
    queryClient.clear();
    useSettingsStore.getState().reset();
    set({ status: "signedOut", user: null });
  },

  setUser: (user) => {
    useSettingsStore.getState().setSettings(user.settings);
    set({ user });
  },
}));

// Refresh token bị từ chối → xoá phiên; app/_layout.tsx tự chuyển về màn đăng nhập.
setAuthFailureHandler(() => useAuthStore.getState().signOut());
