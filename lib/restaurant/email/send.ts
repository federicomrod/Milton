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
