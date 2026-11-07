// The device token lives ONLY in the phone's secure store (Keychain / Keystore).
// Never AsyncStorage, never a URL, never a log. The profile (name, local) is
// not a secret: it is cached in AsyncStorage so the greeting works offline.

import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "milton_device_token";
const PROFILE_KEY = "milton.profile.v1";

export interface Profile {
  name: string;
  location: string;
  company: string | null;
  /** The company language, cached so the first screen is already in it. */
  language?: string;
  /** A manager's own kitchen phone: signs in with their account, no PIN asked. */
  selfDevice?: boolean;
}

/** What the secure store said: «absent» means nobody is signed in; «unreadable» means it could not answer (a locked Keychain on a cold start), which is NOT a lost session. */
export type TokenRead =
  | { kind: "found"; token: string }
  | { kind: "absent" }
  | { kind: "unreadable" };

export async function readToken(): Promise<TokenRead> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    return token ? { kind: "found", token } : { kind: "absent" };
  } catch {
    return { kind: "unreadable" };
  }
}

export async function getToken(): Promise<string | null> {
  const read = await readToken();
  return read.kind === "found" ? read.token : null;
}

// Readable after the first unlock since boot, so a background or cold launch of
// an already signed-in phone still finds it. Never leaves this device.
const ACCESS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const ACCESS_FLAG = "milton.token.access.v1";

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token, ACCESS);
  // A token saved now is already «after first unlock»: nothing to move later.
  try {
    await AsyncStorage.setItem(ACCESS_FLAG, "1");
  } catch {
    // The one-time move will simply check it once.
  }
}

/** The plumbing for the one-time accessibility move (see stay-signed-in.ts). */
export const accessibilityMove = {
  done: async () => (await AsyncStorage.getItem(ACCESS_FLAG)) === "1",
  markDone: () => AsyncStorage.setItem(ACCESS_FLAG, "1"),
  read: readToken,
  write: (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token, ACCESS),
  restore: (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token),
};

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}

export async function getProfile(): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export async function setProfile(profile: Profile | null): Promise<void> {
  try {
    if (profile)
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else await AsyncStorage.removeItem(PROFILE_KEY);
  } catch {
    // The greeting just falls back to the next screen load.
  }
}
