// app/auth/callback/route.ts
//
// Where the email links of Supabase land (signup confirmation, magic link,
// OAuth). Every outcome is visible to the person:
//   * a session → straight in (getPostLoginRedirect); a freshly confirmed
//     email adds ?confirmed=1 so the app shows «Correo confirmado» once.
//   * no session on this device (the PKCE verifier lives in the browser that
//     signed up; the email itself IS confirmed by now) → /auth/confirmed.
//   * the link failed or expired → login, with a clear Spanish message and the
//     way to ask for a new email. Never a silent bounce.
// Both link styles work: `?code=` (PKCE) and `?token_hash=&type=` (verifyOtp,
// if the email template uses it).

import { createClient } from "@/lib/supabase/server";
import { justConfirmed } from "@/lib/auth/email-confirmation";
import { getPostLoginRedirect } from "@/lib/restaurant/post-login";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function withParam(path: string, key: string, value: string): string {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}${key}=${value}${hash ? `#${hash}` : ""}`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const origin = url.origin;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const toLogin = (reason: string) =>
    NextResponse.redirect(`${origin}/auth/login?error=${reason}`);

  // Supabase sends its own failure (e.g. an expired link) as query params.
  if (params.get("error") || params.get("error_code")) {
    console.warn(
      "[auth/callback] provider error:",
      params.get("error_code") ?? params.get("error")
    );
    return toLogin("link_expired");
  }

  if (!code && !tokenHash) {
    return toLogin("link_failed");
  }

  const supabase = await createClient();
  let session = null as Awaited<
    ReturnType<typeof supabase.auth.getSession>
  >["data"]["session"];
  let failure: { name?: string; message?: string } | null = null;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    session = data?.session ?? null;
    failure = error;
    // verifyOtp worked but no session: the email is confirmed anyway.
    if (!error && !session)
      return NextResponse.redirect(`${origin}/auth/confirmed`);
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    session = data?.session ?? null;
    failure = error;
  }

  if (session) {
    const destination = await getPostLoginRedirect(supabase);
    const target = justConfirmed(session.user)
      ? withParam(destination, "confirmed", "1")
      : destination;
    return NextResponse.redirect(`${origin}${target}`);
  }

  // Opened on another device / browser: no PKCE verifier here, but Supabase
  // already confirmed the email before redirecting.
  if (
    failure &&
    (failure.name === "AuthPKCECodeVerifierMissingError" ||
      /code verifier/i.test(failure.message ?? ""))
  ) {
    return NextResponse.redirect(`${origin}/auth/confirmed`);
  }

  console.error("[auth/callback] could not sign in:", failure?.message);
  return toLogin("link_failed");
}
