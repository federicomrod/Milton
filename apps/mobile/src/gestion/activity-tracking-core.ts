// Pure logic for app activity tracking (testable in node without DOM).

export const THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Build the throttle key for this user and surface. Each combination is
 * throttled separately, so a person switching between gestion and cocina
 * (or using both) can ping each once per 15 minutes.
 */
export function throttleKey(userId: string, surface: "gestion" | "cocina"): string {
  return `milton_activity_${userId}_${surface}`;
}

/**
 * Should we ping the endpoint? Yes if the last ping was more than 15 minutes
 * ago (or never).
 */
export function shouldPing(now: number, lastPing: number): boolean {
  return now - lastPing >= THROTTLE_MS;
}
