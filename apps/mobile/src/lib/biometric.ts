// Face ID / fingerprint, as decisions. The native calls are injected (see
// lib/biometric-device.ts for the real ones), so everything here is pure or
// takes a fake in tests. Rule of the module: any failure, cancel or missing
// hardware falls back to typing the PIN, never to a dead end. Nothing here
// uploads anything: the PIN stays on this phone.

export interface BiometricNative {
  hasHardware(): Promise<boolean>;
  isEnrolled(): Promise<boolean>;
  authenticate(prompt: {
    promptMessage: string;
    cancelLabel: string;
  }): Promise<{ success: boolean }>;
}

/** Where the PIN is kept on this phone (the secure store). */
export interface PinVault {
  get(): Promise<string | null>;
  set(pin: string): Promise<void>;
  clear(): Promise<void>;
}

/** Hardware present AND a face / finger enrolled. Any error = not available. */
export async function biometricAvailable(
  native: BiometricNative
): Promise<boolean> {
  try {
    return (await native.hasHardware()) && (await native.isEnrolled());
  } catch {
    return false;
  }
}

/** Offer «Usar Face ID / huella» only when it works and is not on yet. */
export function shouldOffer(input: {
  available: boolean;
  enabled: boolean;
}): boolean {
  return input.available && !input.enabled;
}

export type FallbackReason =
  | "unavailable" // no hardware / nothing enrolled / the module failed
  | "cancelled" // the cook said no or it did not match
  | "no_pin"; // nothing stored on this phone (or it could not be read)

export type UnlockResult =
  | { kind: "pin"; pin: string }
  | { kind: "fallback"; reason: FallbackReason };

/** Ask for the face / finger, then hand over the stored PIN. */
export async function unlockStoredPin(
  native: BiometricNative,
  vault: PinVault,
  prompt: { promptMessage: string; cancelLabel: string }
): Promise<UnlockResult> {
  if (!(await biometricAvailable(native))) {
    return { kind: "fallback", reason: "unavailable" };
  }
  let success = false;
  try {
    success = (await native.authenticate(prompt)).success;
  } catch {
    return { kind: "fallback", reason: "cancelled" };
  }
  if (!success) return { kind: "fallback", reason: "cancelled" };
  let pin: string | null = null;
  try {
    pin = await vault.get();
  } catch {
    pin = null;
  }
  return pin ? { kind: "pin", pin } : { kind: "fallback", reason: "no_pin" };
}

/** Turn it on: keep the PIN on this phone. False = it could not be saved. */
export async function enableBiometric(
  vault: PinVault,
  pin: string
): Promise<boolean> {
  try {
    await vault.set(pin);
    return true;
  } catch {
    return false;
  }
}

/** Turn it off (also on «Cerrar sesión»): the stored PIN is deleted. */
export async function disableBiometric(vault: PinVault): Promise<void> {
  try {
    await vault.clear();
  } catch {
    // Nothing stored.
  }
}

export const LOCK_AFTER_MS = 60_000;

/**
 * App lock: ask when the app opens, and when it comes back after more than 60 s
 * in the background. `backgroundedAt` is null when it never went to the
 * background since the last unlock (a cold open counts as «never unlocked»).
 */
export function shouldLock(input: {
  enabled: boolean;
  unlockedOnce: boolean;
  backgroundedAt: number | null;
  now: number;
  graceMs?: number;
}): boolean {
  if (!input.enabled) return false;
  if (!input.unlockedOnce) return true;
  if (input.backgroundedAt === null) return false;
  return input.now - input.backgroundedAt >= (input.graceMs ?? LOCK_AFTER_MS);
}

/** The typed PIN against the stored one. No stored PIN = nothing to lock with. */
export function localPinMatches(
  entered: string,
  stored: string | null
): boolean {
  return stored !== null && entered.length > 0 && entered === stored;
}

/**
 * «Usar Face ID / huella»: confirm with the face / finger once, then keep the
 * PIN on this phone. False = not turned on (no hardware, cancelled, not saved).
 */
export async function confirmAndStorePin(
  native: BiometricNative,
  vault: PinVault,
  pin: string,
  prompt: { promptMessage: string; cancelLabel: string }
): Promise<boolean> {
  if (!(await biometricAvailable(native))) return false;
  try {
    if (!(await native.authenticate(prompt)).success) return false;
  } catch {
    return false;
  }
  return enableBiometric(vault, pin);
}
