// Prod bugs 1, items 2–4: the pure helpers and the callback route.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authCallbackUrl,
  isEmailNotConfirmed,
  isInvalidCredentials,
  justConfirmed,
  loginProblem,
  loginUrlProblem,
  resendConfirmation,
} from "@/lib/auth/email-confirmation";

describe("email confirmation helpers", () => {
  it("detects «Email not confirmed» by code, then by message", () => {
    expect(isEmailNotConfirmed({ code: "email_not_confirmed" })).toBe(true);
    expect(isEmailNotConfirmed({ message: "Email not confirmed" })).toBe(true);
    expect(isEmailNotConfirmed({ message: "Invalid login credentials" })).toBe(
      false
    );
    expect(isEmailNotConfirmed(null)).toBe(false);
  });
  it("maps the sign-in errors to Spanish", () => {
    expect(loginProblem({ message: "Invalid login credentials" })).toEqual({
      kind: "credentials",
      message: "Correo o contraseña incorrectos.",
    });
    expect(
      loginProblem({ code: "invalid_credentials", message: "x" }).kind
    ).toBe("credentials");
    expect(isInvalidCredentials({ message: "Invalid login credentials" })).toBe(
      true
    );
    expect(loginProblem({ code: "email_not_confirmed", message: "x" })).toEqual(
      {
        kind: "unconfirmed",
        message:
          "Tu correo aún no está confirmado. Revisa tu bandeja (y spam).",
      }
    );
  });
  it("the ?error= codes of the callback become messages", () => {
    expect(loginUrlProblem(null)).toBeNull();
    expect(loginUrlProblem("link_failed")?.kind).toBe("unconfirmed");
    expect(loginUrlProblem("link_expired")?.kind).toBe("unconfirmed");
  });
  it("the redirect is ${origin}/auth/callback (NEXT_PUBLIC_APP_URL wins; no trailing slash)", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(authCallbackUrl("https://app.example.test")).toBe(
      "https://app.example.test/auth/callback"
    );
    process.env.NEXT_PUBLIC_APP_URL = "https://prod.example.test/";
    expect(authCallbackUrl("https://app.example.test")).toBe(
      "https://prod.example.test/auth/callback"
    );
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  });
  it("resend sends type signup with the callback as redirect; maps rate limits and errors", async () => {
    const resend = vi.fn().mockResolvedValue({ error: null });
    expect(
      await resendConfirmation({ auth: { resend } }, " ana@correo.com ")
    ).toEqual({ ok: true });
    expect(resend.mock.calls[0][0]).toMatchObject({
      type: "signup",
      email: "ana@correo.com",
    });
    expect(resend.mock.calls[0][0].options.emailRedirectTo).toMatch(
      /\/auth\/callback$/
    );
    const limited = vi.fn().mockResolvedValue({
      error: {
        message:
          "For security purposes, you can only request this after 45 seconds",
      },
    });
    expect(
      (
        (await resendConfirmation({ auth: { resend: limited } }, "a@b.co")) as {
          message: string;
        }
      ).message
    ).toContain("Espera un momento");
    const broken = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    expect(
      (
        (await resendConfirmation({ auth: { resend: broken } }, "a@b.co")) as {
          message: string;
        }
      ).message
    ).toContain("No pudimos reenviar");
    expect(
      (
        (await resendConfirmation({ auth: { resend } }, "  ")) as {
          ok: boolean;
        }
      ).ok
    ).toBe(false);
  });
  it("justConfirmed: only a moments-old confirmation", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(
      justConfirmed({ email_confirmed_at: "2026-10-15T11:58:00Z" }, now)
    ).toBe(true);
    expect(
      justConfirmed({ email_confirmed_at: "2026-10-10T11:58:00Z" }, now)
    ).toBe(false);
    expect(justConfirmed({ email_confirmed_at: null }, now)).toBe(false);
  });
});

// ---- the callback route ----
const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, verifyOtp } }),
}));
vi.mock("@/lib/restaurant/post-login", async () => ({
  getPostLoginRedirect: async () => "/dashboard/restaurant",
  // the real, dependency-free function
  safeNextPath: (await import("@/lib/auth/safe-next")).safeNextPath,
}));

describe("GET /auth/callback", () => {
  const call = async (qs: string) => {
    const { GET } = await import("@/app/auth/callback/route");
    const res = await GET(
      new Request(`https://app.example.test/auth/callback${qs}`) as never
    );
    return res.headers.get("location");
  };
  const fresh = () => new Date().toISOString();
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
  });
  it("a session → straight in, with «?confirmed=1» when the email was just confirmed", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { user: { email_confirmed_at: fresh() } } },
      error: null,
    });
    expect(await call("?code=abc")).toBe(
      "https://app.example.test/dashboard/restaurant?confirmed=1"
    );
  });
  it("a session for an old login (magic link / OAuth) → in, without the banner", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: {
        session: { user: { email_confirmed_at: "2026-01-01T00:00:00Z" } },
      },
      error: null,
    });
    expect(await call("?code=abc")).toBe(
      "https://app.example.test/dashboard/restaurant"
    );
  });
  it("a safe ?next= wins over the default landing; an unsafe one is ignored", async () => {
    const session = {
      data: {
        session: { user: { email_confirmed_at: "2026-01-01T00:00:00Z" } },
      },
      error: null,
    };
    exchangeCodeForSession.mockResolvedValue(session);
    expect(
      await call("?code=abc&next=%2Fdashboard%2Frestaurant%2Fplatos")
    ).toBe("https://app.example.test/dashboard/restaurant/platos");
    for (const bad of [
      "%2F%2Fevil.com",
      "https%3A%2F%2Fevil.com",
      "%2Fauth%2Flogin",
    ]) {
      exchangeCodeForSession.mockResolvedValue(session);
      expect(await call(`?code=abc&next=${bad}`)).toBe(
        "https://app.example.test/dashboard/restaurant"
      );
    }
  });
  it("no session because the PKCE verifier is missing (another device) → /auth/confirmed", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: {
        name: "AuthPKCECodeVerifierMissingError",
        message: "PKCE code verifier not found in storage",
      },
    });
    expect(await call("?code=abc")).toBe(
      "https://app.example.test/auth/confirmed"
    );
  });
  it("a failed exchange → login with a clear error (the resend is offered there)", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { name: "AuthApiError", message: "invalid flow state" },
    });
    expect(await call("?code=abc")).toBe(
      "https://app.example.test/auth/login?error=link_failed"
    );
  });
  it("the token_hash + type variant goes through verifyOtp", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: { user: { email_confirmed_at: fresh() } } },
      error: null,
    });
    expect(await call("?token_hash=h&type=signup")).toBe(
      "https://app.example.test/dashboard/restaurant?confirmed=1"
    );
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "signup" });
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: "Token has expired or is invalid" },
    });
    expect(await call("?token_hash=h&type=signup")).toBe(
      "https://app.example.test/auth/login?error=link_failed"
    );
    verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    expect(await call("?token_hash=h&type=signup")).toBe(
      "https://app.example.test/auth/confirmed"
    );
  });
  it("Supabase's own error (an expired link) and a bare visit go to login with a message", async () => {
    expect(await call("?error=access_denied&error_code=otp_expired")).toBe(
      "https://app.example.test/auth/login?error=link_expired"
    );
    expect(await call("")).toBe(
      "https://app.example.test/auth/login?error=link_failed"
    );
  });
});
