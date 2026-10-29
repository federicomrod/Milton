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
}

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

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
