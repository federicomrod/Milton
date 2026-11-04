// The real phone bindings of lib/biometric.ts: expo-local-authentication for the
// face / finger, expo-secure-store for the PIN (never AsyncStorage), and two
// non-secret switches in AsyncStorage. Nothing here touches the network.

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BiometricNative, PinVault } from "./biometric";

const PIN_KEY = "milton_bio_pin";
const FLAGS_KEY = "milton.bio.v1";

export const nativeBiometric: BiometricNative = {
  hasHardware: () => LocalAuthentication.hasHardwareAsync(),
  isEnrolled: () => LocalAuthentication.isEnrolledAsync(),
  authenticate: async ({ promptMessage, cancelLabel }) => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      // The fallback is OUR PIN field, not the phone's passcode.
      disableDeviceFallback: true,
    });
    return { success: res.success };
  },
};

export const secureVault: PinVault = {
  get: () => SecureStore.getItemAsync(PIN_KEY),
  set: (pin) =>
    SecureStore.setItemAsync(PIN_KEY, pin, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  clear: () => SecureStore.deleteItemAsync(PIN_KEY),
};

export interface BiometricFlags {
  /** The PIN is stored on this phone and Face ID / fingerprint may fill it. */
  enabled: boolean;
  /** Ask for it when the app opens. */
  appLock: boolean;
}

const OFF: BiometricFlags = { enabled: false, appLock: false };

const listeners = new Set<() => void>();
/** The app lock and the switches in Cuenta follow the same flags. */
export function subscribeFlags(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function loadFlags(): Promise<BiometricFlags> {
  try {
    const raw = await AsyncStorage.getItem(FLAGS_KEY);
    if (!raw) return OFF;
    const p = JSON.parse(raw) as Partial<BiometricFlags>;
    return { enabled: p.enabled === true, appLock: p.appLock === true };
  } catch {
    return OFF;
  }
}

export async function saveFlags(flags: BiometricFlags): Promise<void> {
  try {
    await AsyncStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
  } catch {
    // The switch just stays as it was.
  }
  listeners.forEach((l) => l());
}

/** «Cerrar sesión» or turning it off: the PIN and both switches are gone. */
export async function wipeBiometric(): Promise<void> {
  try {
    await secureVault.clear();
  } catch {
    // Nothing stored.
  }
  await saveFlags(OFF);
}
