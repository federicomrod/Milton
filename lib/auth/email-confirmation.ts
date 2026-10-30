// lib/auth/email-confirmation.ts
//
// Pure helpers for the email-confirmation flow (signup, login, callback).

import { t, type PreferredLanguage } from "@/lib/restaurant/language";

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

// The same messages in the other languages. The constants above stay the
// Spanish default; callers that know the language pass `lang`.
function notConfirmed(lang: PreferredLanguage): string {
  return t(
    lang,
    "Your email is not confirmed yet. Check your inbox (and spam).",
    MSG_NOT_CONFIRMED,
    "Ihre E-Mail-Adresse ist noch nicht bestätigt. Prüfen Sie Ihren Posteingang (und den Spam-Ordner)."
  );
}
function badCredentials(lang: PreferredLanguage): string {
  return t(
    lang,
    "Incorrect email or password.",
    MSG_BAD_CREDENTIALS,
    "E-Mail-Adresse oder Passwort falsch."
  );
}
function linkFailed(lang: PreferredLanguage): string {
  return t(
    lang,
    "We could not confirm your email with that link. It may have expired: request a new one.",
    MSG_LINK_FAILED,
    "Wir konnten Ihre E-Mail-Adresse mit diesem Link nicht bestätigen. Er ist möglicherweise abgelaufen: Fordern Sie einen neuen an."
  );
}

export type LoginProblem =
  | { kind: "unconfirmed"; message: string }
  | { kind: "credentials"; message: string }
  | { kind: "other"; message: string };

/** A sign-in error as a Spanish message (and what the form should offer). */
export function loginProblem(
  error: AuthErrorLike,
  lang: PreferredLanguage = "es"
): LoginProblem {
  if (isEmailNotConfirmed(error))
    return { kind: "unconfirmed", message: notConfirmed(lang) };
  if (isInvalidCredentials(error))
    return { kind: "credentials", message: badCredentials(lang) };
  return {
    kind: "other",
    message:
      error.message?.trim() ||
      t(
        lang,
        "We could not sign you in. Try again.",
        "No pudimos iniciar tu sesión. Inténtalo de nuevo.",
        "Die Anmeldung ist fehlgeschlagen. Versuchen Sie es erneut."
      ),
  };
}

/** The `?error=` codes the callback sends to the login page. */
export function loginUrlProblem(
  raw: string | null,
  lang: PreferredLanguage = "es"
): LoginProblem | null {
  if (!raw) return null;
  if (raw === "link_failed" || raw === "link_expired")
    return { kind: "unconfirmed", message: linkFailed(lang) };
  if (raw === "email_not_confirmed")
    return { kind: "unconfirmed", message: notConfirmed(lang) };
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
  email: string,
  lang: PreferredLanguage = "es"
): Promise<{ ok: true } | { ok: false; message: string }> {
  const address = email.trim();
  if (!address)
    return {
      ok: false,
      message: t(
        lang,
        "Enter your email to resend the link.",
        "Escribe tu correo para reenviar el enlace.",
        "Geben Sie Ihre E-Mail-Adresse ein, um den Link erneut zu senden."
      ),
    };
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
      message: t(
        lang,
        "We just sent an email. Wait a moment and try again.",
        "Ya enviamos un correo hace poco. Espera un momento e inténtalo de nuevo.",
        "Wir haben Ihnen gerade eine E-Mail gesendet. Warten Sie einen Moment und versuchen Sie es erneut."
      ),
    };
  return {
    ok: false,
    message: t(
      lang,
      "We could not resend the email. Try again.",
      "No pudimos reenviar el correo. Inténtalo de nuevo.",
      "Die E-Mail konnte nicht erneut gesendet werden. Versuchen Sie es erneut."
    ),
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
