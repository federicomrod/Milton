// Build-time feature flags. EXPO_PUBLIC_* values are inlined by Expo at bundle
// time, so callers pass the literal `process.env.EXPO_PUBLIC_…` expression.

/** Push notifications are OFF unless the build sets EXPO_PUBLIC_PUSH_ENABLED
 *  to "1" or "true". While off, managers never see the Notificaciones row or
 *  screen (and so never the register-this-phone error). */
export function isPushEnabled(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

export const PUSH_ENABLED = isPushEnabled(process.env.EXPO_PUBLIC_PUSH_ENABLED);
