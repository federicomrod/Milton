// The manager's session. The tokens live ONLY in the phone's secure store
// (Keychain / Keystore), never AsyncStorage, never a URL, never a log. What is
// not secret (which company, restaurant and mode were last used) is kept in
// AsyncStorage so the app opens where it was.

import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ManagerTokens, ManagerUser } from "./types";

const ACCESS_KEY = "milton_mgr_access";
const REFRESH_KEY = "milton_mgr_refresh";
const META_KEY = "milton.mgr.meta.v1";

export type Mode = "manager" | "kitchen";

interface Meta {
  expiresAt: number | null;
  user: ManagerUser;
  companyId: string | null;
  locationId: string | null;
  mode: Mode;
}

export async function loadTokens(): Promise<ManagerTokens | null> {
  try {
    const [accessToken, refreshToken, raw] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      AsyncStorage.getItem(META_KEY),
    ]);
    if (!accessToken || !refreshToken || !raw) return null;
    const meta = JSON.parse(raw) as Meta;
    return {
      accessToken,
      refreshToken,
      expiresAt: meta.expiresAt,
      user: meta.user,
    };
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: ManagerTokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
  const prev = await loadMeta();
  await saveMeta({
    expiresAt: tokens.expiresAt,
    user: tokens.user,
    companyId: prev?.companyId ?? null,
    locationId: prev?.locationId ?? null,
    mode: prev?.mode ?? "manager",
  });
}

export async function loadMeta(): Promise<Meta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as Meta) : null;
  } catch {
    return null;
  }
}

export async function saveMeta(meta: Meta): Promise<void> {
  try {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // The app just opens on the defaults next time.
  }
}

export async function clearTokens(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    await AsyncStorage.removeItem(META_KEY);
  } catch {
    // Nothing stored.
  }
}
