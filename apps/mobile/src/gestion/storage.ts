// The manager's session. The tokens live ONLY in the phone's secure store
// (Keychain / Keystore), never AsyncStorage, never a URL, never a log. What is
// not secret (which company, restaurant and mode were last used) is kept in
// AsyncStorage so the app opens where it was.

import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { tokenLoadOf, type TokenLoad } from "./session-core";
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

/**
 * found / absent / unreadable. A store that cannot answer right now (a locked
 * Keychain on a cold start, a storage hiccup) is «unreadable», never «absent»:
 * only «absent» means nobody is signed in.
 */
export async function loadTokens(): Promise<TokenLoad> {
  try {
    const [access, refresh, meta] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      AsyncStorage.getItem(META_KEY),
    ]);
    return tokenLoadOf({ access, refresh, meta });
  } catch {
    return { kind: "unreadable" };
  }
}

// Readable after the first unlock, so a cold or background launch of a phone
// that is already signed in still finds the session. Saving over an existing
// item updates it in place (expo-secure-store 58), so existing logins move the
// next time the session is renewed. Never leaves this device.
const ACCESS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function saveTokens(tokens: ManagerTokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken, ACCESS);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, ACCESS);
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
