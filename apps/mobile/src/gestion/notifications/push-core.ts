// Pure rules of the phone's notification side (tested without a device).

export type PushScreen = "inicio" | "costos" | "ventas" | "rentabilidad";

const ROUTES: Record<PushScreen, string> = {
  inicio: "/",
  costos: "/costos",
  ventas: "/ventas",
  rentabilidad: "/rentabilidad",
};

/**
 * Where a tapped notification goes. Only the screens above are possible: any
 * other value in the payload (an unknown screen, a path, a link) opens Inicio,
 * so a notification can never send the app somewhere unexpected.
 */
export function routeForNotification(data: unknown): string {
  const screen =
    data && typeof data === "object"
      ? (data as { screen?: unknown }).screen
      : undefined;
  return typeof screen === "string" && Object.hasOwn(ROUTES, screen)
    ? ROUTES[screen as PushScreen]
    : ROUTES.inicio;
}

export type PermissionView =
  | "ask" // never asked: show «Activar»
  | "on"
  | "denied"; // the person said no: only Settings can change it

export function permissionView(status: {
  granted: boolean;
  canAskAgain: boolean;
}): PermissionView {
  if (status.granted) return "on";
  return status.canAskAgain ? "ask" : "denied";
}

export type PushUnavailable = "simulator" | "no-project";

/**
 * Can this build get a push token at all? A simulator cannot, and a build
 * without an Expo project id (not created yet) cannot either. Say which.
 */
export function pushUnavailable(args: {
  isDevice: boolean;
  projectId: string | null | undefined;
}): PushUnavailable | null {
  if (!args.isDevice) return "simulator";
  if (!args.projectId) return "no-project";
  return null;
}

/** 0-23 → «08:00». */
export function hourLabel(hour: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, "0")}:00`;
}

/** Step an hour up or down, wrapping around midnight. */
export function stepHour(hour: number, by: 1 | -1): number {
  return (((hour + by) % 24) + 24) % 24;
}

export interface Choices {
  dailyEnabled: boolean;
  criticalEnabled: boolean;
  dailyHour: number;
  quietStart: number;
  quietEnd: number;
}

export const DEFAULT_CHOICES: Choices = {
  dailyEnabled: true,
  criticalEnabled: true,
  dailyHour: 8,
  quietStart: 22,
  quietEnd: 7,
};

/** The device timezone, always a string the server accepts (falls back to UTC). */
export function deviceTimezone(
  resolve: () => string | undefined = () =>
    Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  try {
    return resolve() || "UTC";
  } catch {
    return "UTC";
  }
}
