// lib/ai/alert.ts
//
// Admin alert for AI quota/billing errors and the daily cost check. Sends one
// email through the existing sender (lib/restaurant/email/send.ts). If no
// admin address is configured it only logs one `[ai-alert]` line.
//
// AI_ALERT_EMAIL is optional (see the PR: needs Fede's yes to set it).
// Never includes prompts, answers or keys.

import { sendBriefingEmail } from "@/lib/restaurant/email/send";

export function aiAlertAddress(): string | null {
  const to = process.env.AI_ALERT_EMAIL?.trim();
  return to ? to : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendAiAlert(
  subject: string,
  lines: string[]
): Promise<void> {
  const to = aiAlertAddress();
  if (!to) {
    console.warn(`[ai-alert] ${subject} — ${lines.join(" | ")}`);
    return;
  }
  try {
    const result = await sendBriefingEmail({
      to,
      subject,
      text: lines.join("\n"),
      html: `<p>${lines.map(escapeHtml).join("</p><p>")}</p>`,
    });
    if (!result.ok) console.warn(`[ai-alert] email not sent — ${subject}`);
  } catch {
    console.warn(`[ai-alert] email not sent — ${subject}`);
  }
}
