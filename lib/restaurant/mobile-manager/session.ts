// What the app stores after a sign-in: the access token (sent as the bearer),
// the refresh token and when the access token ends. Nothing else.

import type { Session, User } from "@supabase/supabase-js";

export interface SessionBody {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the access token stops working. */
  expiresAt: number | null;
  user: { id: string; email: string | null; name: string | null };
}

export function sessionBody(session: Session, user: User | null): SessionBody {
  const u = user ?? session.user;
  const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    typeof meta.full_name === "string"
      ? meta.full_name
      : typeof meta.name === "string"
        ? meta.name
        : null;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    user: { id: u?.id ?? "", email: u?.email ?? null, name },
  };
}
