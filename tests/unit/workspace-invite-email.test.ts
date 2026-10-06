import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendWorkspaceInviteEmail } from "@/lib/restaurant/email/send";

// Workspace invite email (R1 item 2): Milton-branded bilingual (ES then EN)
// layout. Proves the link and workspace name are HTML-escaped, the subject
// is bilingual, the one-time link is the only call to action, and nothing
// but the link is sent (no password).

const ORIGINAL_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.EMAIL_FROM_ADDRESS;
const LOGO =
  "https://raw.githubusercontent.com/federicomrod/Milton/r1-db-baseline/public/email/milton-logo.png";

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_FakeResendApiKeyForTestsOnly_1234567890";
  delete process.env.EMAIL_FROM_ADDRESS;
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM_ADDRESS;
  else process.env.EMAIL_FROM_ADDRESS = ORIGINAL_FROM;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function send(workspaceName: string, link: string) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await sendWorkspaceInviteEmail({
    to: "cook@restaurant.com",
    link,
    workspaceName,
  });
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return { result, body: JSON.parse(init.body as string) };
}

describe("sendWorkspaceInviteEmail — content", () => {
  const LINK = "https://preview.example.com/auth/invite?token=abc123&x=1";

  it("sends a bilingual subject (ES first, then EN)", async () => {
    const { result, body } = await send("La Cantina", LINK);
    expect(result).toEqual({ ok: true });
    expect(body.subject).toBe(
      "Te han invitado a La Cantina en Milton / You're invited to La Cantina on Milton"
    );
    expect(body.to).toBe("cook@restaurant.com");
  });

  it("uses the branded layout: logo, blue button, fallback link, footer", async () => {
    const { body } = await send("La Cantina", LINK);
    const html: string = body.html;
    expect(html).toContain(`<img src="${LOGO}"`);
    expect(html).toContain("max-width:560px");
    expect(html).toContain('bgcolor="#1B40C8"');
    expect(html).toContain("Activar cuenta / Activate account");
    expect(html).toContain("miltonlabs.ai");
    // Spanish block comes before the English block.
    expect(html.indexOf('lang="es"')).toBeGreaterThan(-1);
    expect(html.indexOf('lang="es"')).toBeLessThan(html.indexOf('lang="en"'));
    // Exactly two links to the invite: the button and the fallback link.
    const escapedLink = LINK.replace(/&/g, "&amp;");
    expect(html.split(`href="${escapedLink}"`).length - 1).toBe(2);
    expect(html).toContain(`>${escapedLink}</a>`);
    // No external stylesheets, fonts or tracking pixels.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import|<script/i);
    expect(html.match(/<img\b/gi)).toHaveLength(1);
  });

  it("HTML-escapes the workspace name and the link", async () => {
    const { body } = await send(
      `<b>"Evil" & Co</b>`,
      `https://x.example/auth/invite?token=t"><script>`
    );
    const html: string = body.html;
    expect(html).toContain(
      "<strong>&lt;b&gt;&quot;Evil&quot; &amp; Co&lt;/b&gt;</strong>"
    );
    expect(html).toContain(
      'href="https://x.example/auth/invite?token=t&quot;&gt;&lt;script&gt;"'
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
  });

  it("plain-text part is bilingual and contains only the link, never a password", async () => {
    const { body } = await send("La Cantina", LINK);
    const text: string = body.text;
    expect(text.indexOf("Te han invitado")).toBeLessThan(
      text.indexOf("You've been invited")
    );
    expect(text.split(LINK).length - 1).toBe(2);
    expect(text).toContain("7 días");
    expect(text).toContain("expires in 7 days and works once");
    expect(text.toLowerCase()).not.toMatch(/password:|contraseña:/);
  });

  it("keeps the From fallback when EMAIL_FROM_ADDRESS is unset", async () => {
    const { body } = await send("La Cantina", LINK);
    expect(body.from).toBe("Milton <briefings@sendmilton.com>");
  });
});
