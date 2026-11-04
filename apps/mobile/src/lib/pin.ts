// The cook's PIN: the same rules the server enforces (4–6 digits, not all the
// same digit, not a straight run like 1234 or 9876), checked on the phone first
// so the cook gets a friendly message in their language. Pure, no storage.

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export type PinProblem = "format" | "weak" | "mismatch";

/** 4–6 digits only. */
export function isPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

/** Too easy to guess: 0000, 111111, 1234, 4321, 123456. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  return "0123456789".includes(pin) || "9876543210".includes(pin);
}

/** null = fine. `confirm` is checked only when given. */
export function pinProblem(pin: string, confirm?: string): PinProblem | null {
  if (!isPinFormat(pin)) return "format";
  if (isWeakPin(pin)) return "weak";
  if (confirm !== undefined && confirm !== pin) return "mismatch";
  return null;
}

/** Keep only digits while the cook types (no spaces, no letters). */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, PIN_MAX);
}

/** «K7M2QX», typed with spaces or in lower case, goes to the server tidy. */
export function normalizeKitchenCode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Whole minutes to wait (at least 1) for a «locked» answer. */
export function lockMinutes(retryAfterSeconds: number | undefined): number {
  const seconds =
    typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
      ? retryAfterSeconds
      : 900;
  return Math.max(1, Math.ceil(seconds / 60));
}

export type PinLoginOutcome =
  | { kind: "failed" } // wrong code, name or PIN: never says which
  | { kind: "locked"; minutes: number }
  | { kind: "other" }; // offline, server trouble…: the generic messages

/** What the PIN screen shows for a failed /kitchen/pin-login. */
export function pinLoginOutcome(
  err: {
    kind?: string;
    status?: number;
    reason?: string;
    retryAfterSeconds?: number;
  } | null
): PinLoginOutcome {
  if (!err) return { kind: "other" };
  if (err.reason === "locked" || err.status === 429) {
    return { kind: "locked", minutes: lockMinutes(err.retryAfterSeconds) };
  }
  if (err.reason === "failed" || err.status === 401) return { kind: "failed" };
  return { kind: "other" };
}
