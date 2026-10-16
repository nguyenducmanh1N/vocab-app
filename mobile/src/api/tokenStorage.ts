import * as SecureStore from "expo-secure-store";

import type { TokenPair } from "./types";

const ACCESS_KEY = "vt_access";
const REFRESH_KEY = "vt_refresh";

type Tokens = { access: string; refresh: string };

// Bản trong bộ nhớ để mỗi request không phải đọc SecureStore. undefined = chưa nạp.
let cache: Tokens | null | undefined;

export async function loadTokens(): Promise<Tokens | null> {
  if (cache !== undefined) return cache;
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  cache = access && refresh ? { access, refresh } : null;
  return cache;
}

export async function saveTokens(pair: TokenPair): Promise<void> {
  cache = { access: pair.access_token, refresh: pair.refresh_token };
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, pair.access_token),
    SecureStore.setItemAsync(REFRESH_KEY, pair.refresh_token),
  ]);
}

export async function clearTokens(): Promise<void> {
  cache = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
