// lib/restaurant/push/sender.ts
//
// Sends through Expo's push service (which talks to APNs / FCM). OFF unless the
// server has PUSH_ENABLED=1: enabling it is a hosted step (APNs credentials in
// the Expo project, the variable on Vercel) that needs explicit approval.
// SECURITY: never logs a token, a title or a body.

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export function isPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUSH_ENABLED === "1";
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  priority: "high" | "default";
  channelId?: string;
}

export interface ExpoTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

export interface SendResult {
  /** One per message, in order. null = the service did not answer for it. */
  tickets: (ExpoTicket | null)[];
  ok: boolean;
}

export async function sendExpoPush(
  messages: ExpoMessage[],
  deps: { fetchImpl?: typeof fetch; accessToken?: string | undefined } = {}
): Promise<SendResult> {
  if (messages.length === 0) return { tickets: [], ok: true };
  const doFetch = deps.fetchImpl ?? fetch;
  const token = deps.accessToken ?? process.env.EXPO_ACCESS_TOKEN;
  try {
    const res = await doFetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) return { tickets: messages.map(() => null), ok: false };
    const json = (await res.json()) as { data?: ExpoTicket[] };
    const data = Array.isArray(json.data) ? json.data : [];
    return {
      tickets: messages.map((_, i) => data[i] ?? null),
      ok: true,
    };
  } catch {
    return { tickets: messages.map(() => null), ok: false };
  }
}

/** The phone no longer has the app (or the token): stop sending to it. */
export function isDeadToken(t: ExpoTicket | null): boolean {
  return t?.status === "error" && t.details?.error === "DeviceNotRegistered";
}
