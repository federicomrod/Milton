// lib/auth/email-confirmation.ts
//
// Pure helpers for the email-confirmation flow (signup, login, callback).

/** Seconds before «Reenviar correo» can be used again. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Where the confirmation link must land: `${origin}/auth/callback`. */
export function authCallbackUrl(origin?: string | null): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    origin ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/+$/, "")}/auth/callback`;
}

interface AuthErrorLike {
  code?: string | null;
  message?: string | null;
  name?: string | null;
}

export function isEmailNotConfirmed(error: AuthErrorLike | null | undefined) {
  if (!error) return false;
  if (error.code === "email_not_confirmed") return true;
  return /email not confirmed/i.test(error.message ?? "");
}

export function isInvalidCredentials(error: AuthErrorLike | null | undefined) {
  if (!error) return false;
  if (error.code === "invalid_credentials") return true;
  return /invalid login credentials/i.test(error.message ?? "");
}

export const MSG_NOT_CONFIRMED =
  "Tu correo aún no está confirmado. Revisa tu bandeja (y spam).";
export const MSG_BAD_CREDENTIALS = "Correo o contraseña incorrectos.";
export const MSG_LINK_FAILED =
  "No pudimos confirmar tu correo con ese enlace. Puede haber vencido: pide uno nuevo.";

export type LoginProblem =
  | { kind: "unconfirmed"; message: string }
  | { kind: "credentials"; message: string }
  | { kind: "other"; message: string };

/** A sign-in error as a Spanish message (and what the form should offer). */
export function loginProblem(error: AuthErrorLike): LoginProblem {
  if (isEmailNotConfirmed(error))
    return { kind: "unconfirmed", message: MSG_NOT_CONFIRMED };
  if (isInvalidCredentials(error))
    return { kind: "credentials", message: MSG_BAD_CREDENTIALS };
  return {
    kind: "other",
    message:
      error.message?.trim() ||
      "No pudimos iniciar tu sesión. Inténtalo de nuevo.",
  };
}

/** The `?error=` codes the callback sends to the login page. */
export function loginUrlProblem(raw: string | null): LoginProblem | null {
  if (!raw) return null;
  if (raw === "link_failed" || raw === "link_expired")
    return { kind: "unconfirmed", message: MSG_LINK_FAILED };
  if (raw === "email_not_confirmed")
    return { kind: "unconfirmed", message: MSG_NOT_CONFIRMED };
  return { kind: "other", message: raw };
}

interface ResendClient {
  auth: {
    resend: (args: {
      type: "signup";
      email: string;
      options?: { emailRedirectTo?: string };
    }) => Promise<{ error: AuthErrorLike | null }>;
  };
}

/** Resend the confirmation email; the link lands on /auth/callback. */
export async function resendConfirmation(
  supabase: ResendClient,
  email: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const address = email.trim();
  if (!address)
    return { ok: false, message: "Escribe tu correo para reenviar el enlace." };
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: address,
    options: { emailRedirectTo: authCallbackUrl() },
  });
  if (!error) return { ok: true };
  if (
    /rate limit|too many|after \d+ seconds/i.test(error.message ?? "") ||
    error.code === "over_email_send_rate_limit"
  )
    return {
      ok: false,
      message:
        "Ya enviamos un correo hace poco. Espera un momento e inténtalo de nuevo.",
    };
  return {
    ok: false,
    message: "No pudimos reenviar el correo. Inténtalo de nuevo.",
  };
}

/** The email was confirmed moments ago (this callback is its confirmation). */
export function justConfirmed(
  user: { email_confirmed_at?: string | null } | null | undefined,
  now = Date.now()
): boolean {
  const at = user?.email_confirmed_at
    ? Date.parse(user.email_confirmed_at)
    : NaN;
  return Number.isFinite(at) && now - at < 10 * 60_000 && now - at > -60_000;
}
