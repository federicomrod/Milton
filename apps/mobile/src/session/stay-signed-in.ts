// Pure rules of «stay signed in». The device token has no silent expiry: only a
// confirmed revoke (see unauthorizedAction in api/client.ts), «Cerrar sesión»
// or a reinstall ends it. When a revoke ends it, the outbox is kept for the
// same cook and only discarded for a different one.

export type OutboxOnSignIn = "keep" | "clear";

/**
 * `previousStaffId` is the cook who last used this phone (remembered across a
 * confirmed revoke; forgotten by an explicit «Cerrar sesión»). Same cook: the
 * unsent items resume. Anyone else, or nobody known: they must not inherit them.
 */
export function outboxOnSignIn(
  previousStaffId: string | null,
  staffId: string
): OutboxOnSignIn {
  return previousStaffId !== null && previousStaffId === staffId
    ? "keep"
    : "clear";
}

export type PinGate = "none" | "create" | "change";

export interface PinStateLike {
  set: boolean;
  mustChange: boolean;
}

/**
 * Does the cook have to set a PIN before continuing? `null` = not known yet
 * (offline, older server): never block on a guess.
 */
export function pinGate(pin: PinStateLike | null | undefined): PinGate {
  if (!pin) return "none";
  if (pin.mustChange) return "change";
  if (!pin.set) return "create";
  return "none";
}

/** Reads the token, retrying an «unreadable» answer a few times (a Keychain that is not ready yet). */
export async function readTokenPatiently(
  read: () => Promise<import("../storage/token").TokenRead>,
  wait: (ms: number) => Promise<void>,
  attempts = 3,
  delayMs = 300
): Promise<import("../storage/token").TokenRead> {
  let last = await read();
  for (let i = 1; i < attempts && last.kind === "unreadable"; i++) {
    await wait(delayMs);
    last = await read();
  }
  return last;
}

/**
 * Opening the app: signed in when a token exists; signed out only when the store
 * clearly has none. An unreadable store with a remembered profile stays signed
 * in (requests read the token again later); it is never treated as a lost session.
 */
export function startupStatus(
  read: import("../storage/token").TokenRead,
  hasProfile: boolean
): "signedIn" | "signedOut" {
  if (read.kind === "found") return "signedIn";
  if (read.kind === "unreadable" && hasProfile) return "signedIn";
  return "signedOut";
}
