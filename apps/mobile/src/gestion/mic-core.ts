// What to do when the person taps the microphone in Preguntar a Milton (pure,
// tested). Only a real permission state may lead to «activa el micrófono en
// Ajustes»; a recording or input failure is a different message.

export interface MicPermission {
  status: "granted" | "denied" | "undetermined" | string;
  granted: boolean;
  /** false once iOS will not show the prompt again (denied or restricted). */
  canAskAgain: boolean;
}

/**
 * record   : permission is already there, start recording.
 * ask      : never decided (or the system may still ask): show the prompt now.
 * settings : denied or restricted; the system will not ask again, only Settings
 *            can change it.
 */
export type MicStep = "record" | "ask" | "settings";

export function micStepFor(p: MicPermission): MicStep {
  if (p.granted || p.status === "granted") return "record";
  return p.canAskAgain ? "ask" : "settings";
}

/** After the prompt was shown: approved → record; anything else → Settings. */
export function micStepAfterAsking(p: MicPermission): "record" | "settings" {
  return p.granted || p.status === "granted" ? "record" : "settings";
}
