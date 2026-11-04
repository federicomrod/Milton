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
