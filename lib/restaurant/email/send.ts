// lib/restaurant/email/send.ts
//
// Email Briefing Extension v1 — server-only email send utility.
//
// Provider: Resend (see the architecture report for why). Implemented via
// a plain fetch() call against Resend's REST API rather than adding the
// `resend` npm package — zero new dependency, same minimal-footprint
// choice already made for Telegram (lib/restaurant/telegram/send.ts uses
// raw fetch against the Bot API for the same reason).
//
// SECURITY: RESEND_API_KEY is read ONLY in this file, sent as a Bearer
// header (never embedded in a URL). Every failure mode resolves to a
// generic EmailSendResult rather than throwing, so a provider outage or
// misconfiguration can never propagate into (and break) the dashboard or
// Telegram briefing paths, neither of which import this module. No
// caught error's `.message` is ever logged — only `.name` or the
// provider's own (non-secret) JSON error description.

const RESEND_API_URL = "https://api.resend.com/emails";

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

export type EmailSendResult = { ok: true } | { ok: false; error: string };

function getApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new EmailConfigError("RESEND_API_KEY is not set.");
  }
  return key;
}

function getFromAddress(): string {
  return process.env.EMAIL_FROM_ADDRESS || "Milton <briefings@sendmilton.com>";
}

export interface BriefingEmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends one briefing email via Resend. Never throws — every failure mode
 * (missing API key, network error, Resend API error response) resolves to
 * { ok: false, error } with a generic, credential-free message.
 */
export async function sendBriefingEmail(
  payload: BriefingEmailPayload
): Promise<EmailSendResult> {
  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err) {
    console.error(
      "[email-send] config error:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "Email delivery is not configured." };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: getFromAddress(),
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    });

    if (!res.ok) {
      // Resend's JSON error body carries a `message` (e.g. "invalid
      // recipient", "domain not verified") — never the API key, so it's
      // safe to log directly.
      let description = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) description = body.message;
      } catch {
        // Non-JSON error body — keep the generic HTTP status description.
      }
      console.error("[email-send] Resend API error:", description);
      return { ok: false, error: "Could not send the briefing email." };
    }

    return { ok: true };
  } catch (err) {
    // Deliberately logs only the error's name, never `.message` — see the
    // file-level security note above.
    console.error(
      "[email-send] request failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "Could not reach the email provider." };
  }
}

// ---------------------------------------------------------------------------
// Workspace invite email (R1 item 2). Best effort: the admin always also
// gets the copyable link, so a failure here is never fatal. The email
// contains only the one-time link — never a password.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Shared Milton email look (matches supabase/templates/*.html on
// r1-db-baseline): table layout, inline CSS, 560px column, logo, one blue
// button, plain fallback link. Bilingual: Spanish first, then English.
// STAGING-ONLY logo URL; production will move to a stable miltonlabs.ai URL.
const EMAIL_LOGO_URL =
  "https://raw.githubusercontent.com/federicomrod/Milton/r1-db-baseline/public/email/milton-logo.png";
const EMAIL_FONT = "'Plus Jakarta Sans', Arial, Helvetica, sans-serif";

/** Both arguments must already be HTML-escaped. */
function workspaceInviteEmailHtml(safeName: string, safeLink: string): string {
  const h1 = `margin:0 0 10px 0;font-family:${EMAIL_FONT};font-size:22px;line-height:30px;font-weight:700;color:#0D1117;`;
  const p = `margin:0;font-family:${EMAIL_FONT};font-size:15px;line-height:24px;color:#0D1117;`;
  const small = `margin:10px 0 0 0;font-family:${EMAIL_FONT};font-size:13px;line-height:20px;color:#5B6570;`;
  const rule = (pad: string) =>
    `<tr><td style="padding:${pad};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #E6E8EC;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table></td></tr>`;
  return (
    `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<title>Milton</title></head>` +
    `<body style="margin:0;padding:0;background-color:#ffffff;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;"><tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">` +
    `<tr><td style="padding:0 0 28px 0;"><img src="${EMAIL_LOGO_URL}" width="160" height="42" alt="Milton" style="display:block;width:160px;height:42px;border:0;outline:none;text-decoration:none;"></td></tr>` +
    `<tr><td lang="es" style="font-family:${EMAIL_FONT};color:#0D1117;">` +
    `<h1 style="${h1}">Te han invitado a Milton</h1>` +
    `<p style="${p}">Te han invitado a unirte a <strong>${safeName}</strong> en Milton, el asistente para la operación de tu restaurante. Crea tu contraseña y activa tu cuenta con el botón de abajo.</p>` +
    `<p style="${small}">El enlace caduca en 7 días y solo funciona una vez.</p>` +
    `</td></tr>` +
    rule("24px 0") +
    `<tr><td lang="en" style="font-family:${EMAIL_FONT};color:#0D1117;">` +
    `<h1 style="${h1}">You're invited to Milton</h1>` +
    `<p style="${p}">You've been invited to join <strong>${safeName}</strong> on Milton, your restaurant operations assistant. Set your password and activate your account with the button below.</p>` +
    `<p style="${small}">The link expires in 7 days and works once.</p>` +
    `</td></tr>` +
    `<tr><td style="padding:28px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" bgcolor="#1B40C8" style="background-color:#1B40C8;border-radius:999px;mso-padding-alt:14px 28px;">` +
    `<a href="${safeLink}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${EMAIL_FONT};font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">Activar cuenta / Activate account</a>` +
    `</td></tr></table></td></tr>` +
    `<tr><td style="padding:20px 0 0 0;font-family:${EMAIL_FONT};font-size:13px;line-height:20px;color:#5B6570;">` +
    `¿El botón no funciona? Copia este enlace en tu navegador:<br>Button not working? Paste this link into your browser:<br>` +
    `<a href="${safeLink}" target="_blank" style="color:#1B40C8;text-decoration:underline;word-break:break-all;">${safeLink}</a>` +
    `</td></tr>` +
    rule("32px 0 0 0") +
    `<tr><td style="padding:16px 0 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:18px;color:#5B6570;">` +
    `<strong style="color:#0D1117;">Milton</strong> · <a href="https://miltonlabs.ai" target="_blank" style="color:#5B6570;text-decoration:none;">miltonlabs.ai</a><br>` +
    `<span lang="es">Si no esperabas esta invitación, puedes ignorar este correo.</span><br>` +
    `<span lang="en">If you weren't expecting this, you can ignore this email.</span>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

export async function sendWorkspaceInviteEmail(payload: {
  to: string;
  link: string;
  workspaceName: string;
}): Promise<EmailSendResult> {
  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err) {
    console.error(
      "[email-send] config error:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "Email delivery is not configured." };
  }

  const name = payload.workspaceName;
  const text =
    `Te han invitado a unirte a ${name} en Milton.\n\n` +
    `Crea tu contraseña y activa tu cuenta aquí (el enlace caduca en 7 días y solo funciona una vez):\n${payload.link}\n\n` +
    `Si no esperabas esta invitación, puedes ignorar este correo.\n\n` +
    `---\n\n` +
    `You've been invited to join ${name} on Milton.\n\n` +
    `Set your password and activate your account here (the link expires in 7 days and works once):\n${payload.link}\n\n` +
    `If you weren't expecting this, you can ignore this email.`;
  const html = workspaceInviteEmailHtml(
    escapeHtml(name),
    escapeHtml(payload.link)
  );

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: getFromAddress(),
        to: payload.to,
        subject: `Te han invitado a ${name} en Milton / You're invited to ${name} on Milton`,
        html,
        text,
      }),
    });
    if (!res.ok) {
      console.error("[email-send] invite email failed: HTTP", res.status);
      return { ok: false, error: "Could not send the invite email." };
    }
    return { ok: true };
  } catch (err) {
    console.error(
      "[email-send] invite request failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, error: "Could not reach the email provider." };
  }
}
