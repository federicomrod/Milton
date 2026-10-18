// @vitest-environment jsdom
// Prod bugs 1, items 1–3: the eye on every password field, «Revisa tu correo»
// after signup (with a resend cooldown) and the Spanish login errors.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

const push = vi.fn();
const refresh = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

const signUp = vi.fn();
const resend = vi.fn();
const signInWithPassword = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp,
      resend,
      signInWithPassword,
      setSession: vi.fn(),
      getSession: vi.fn(),
    },
  }),
}));
vi.mock("@/lib/restaurant/post-login", () => ({
  getPostLoginRedirect: async () => "/dashboard/restaurant",
}));

import { PasswordInput } from "@/components/auth/password-input";
import { ResendConfirmation } from "@/components/auth/resend-confirmation";
import { SignupForm } from "@/components/auth/signup-form";
import { LoginForm } from "@/components/auth/login-form";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const UID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  signUp.mockReset();
  resend.mockReset();
  signInWithPassword.mockReset();
  search = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("1 · PasswordInput", () => {
  it("is hidden by default; the eye shows and hides it, with the right labels; it is a type=button", () => {
    render(<PasswordInput aria-label="clave" defaultValue="secreto" />);
    const input = screen.getByLabelText("clave") as HTMLInputElement;
    const eye = screen.getByRole("button", { name: "Mostrar contraseña" });
    expect(input.type).toBe("password");
    expect(eye.getAttribute("type")).toBe("button");
    fireEvent.click(eye);
    expect(input.type).toBe("text");
    const hide = screen.getByRole("button", { name: "Ocultar contraseña" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);
    expect(input.type).toBe("password");
  });
  it("is keyboard accessible: a real button that takes focus", () => {
    render(<PasswordInput aria-label="clave" />);
    const eye = screen.getByRole("button", { name: "Mostrar contraseña" });
    eye.focus();
    expect(document.activeElement).toBe(eye);
  });
  it("every password field of the app uses it (login, signup, invitation, reset)", () => {
    for (const f of [
      "components/auth/login-form.tsx",
      "components/auth/signup-form.tsx",
      "components/auth/invite-accept-form.tsx",
      "app/auth/reset-password/page.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("PasswordInput");
      expect(src, f).not.toMatch(/<Input[^>]*type="password"/);
    }
  });
});

describe("2 · signup with email confirmation", () => {
  async function fillAndSubmit() {
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Nombre del restaurante"), {
      target: { value: "Mi lugar" },
    });
    fireEvent.change(screen.getByLabelText("Correo"), {
      target: { value: "ana@correo.com" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "secreto1" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    });
  }
  it("no session → «Revisa tu correo» with the address, a resend button and the login link; no redirect", async () => {
    signUp.mockResolvedValue({
      data: { user: { id: UID }, session: null },
      error: null,
    });
    await fillAndSubmit();
    expect(await screen.findByText("Revisa tu correo")).toBeTruthy();
    expect(screen.getByText(/Te enviamos un correo a/).textContent).toContain(
      "ana@correo.com"
    );
    expect(screen.getByText(/Confírmalo y luego vuelve a entrar/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Reenviar correo/ })
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Ir a iniciar sesión" })
        .getAttribute("href")
    ).toBe("/auth/login");
    expect(push).not.toHaveBeenCalled();
    // the profile and company are still created (signup-complete needs no session)
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("/api/auth/signup-complete");
    expect(JSON.parse(calls[0][1].body)).toEqual({
      userId: UID,
      companyName: "Mi lugar",
    });
  });
  it("signUp asks the link to land on /auth/callback (no hard-coded host)", async () => {
    signUp.mockResolvedValue({
      data: { user: { id: UID }, session: null },
      error: null,
    });
    await fillAndSubmit();
    const options = signUp.mock.calls[0][0].options;
    expect(options.emailRedirectTo).toMatch(/\/auth\/callback$/);
    expect(read("lib/auth/email-confirmation.ts")).not.toMatch(
      /https?:\/\/(?!\$)/
    );
  });
  it("a session comes back (confirmation off): the current flow, straight to onboarding", async () => {
    signUp.mockResolvedValue({
      data: { user: { id: UID }, session: { access_token: "x" } },
      error: null,
    });
    await fillAndSubmit();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/onboarding/restaurant")
    );
    expect(screen.queryByText("Revisa tu correo")).toBeNull();
  });
  it("a signUp error is shown, not a screen", async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error("User already registered"),
    });
    await fillAndSubmit();
    expect(await screen.findByText("User already registered")).toBeTruthy();
    expect(screen.queryByText("Revisa tu correo")).toBeNull();
  });
});

describe("2 · resend with a 60 s cooldown", () => {
  it("starts cooling down right after signup, can resend after 60 s, then cools down again", async () => {
    vi.useFakeTimers();
    resend.mockResolvedValue({ error: null });
    render(<ResendConfirmation email="ana@correo.com" startCooldown />);
    const button = () => screen.getByRole("button") as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain("60 s");
    // one tick per second (each tick schedules the next after React re-renders)
    const seconds = async (n: number) => {
      for (let i = 0; i < n; i += 1)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
    };
    await seconds(30);
    expect(button().textContent).toContain("30 s");
    await seconds(30);
    expect(button().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(resend).toHaveBeenCalledTimes(1);
    expect(resend.mock.calls[0][0]).toMatchObject({
      type: "signup",
      email: "ana@correo.com",
    });
    expect(resend.mock.calls[0][0].options.emailRedirectTo).toMatch(
      /\/auth\/callback$/
    );
    expect(screen.getByRole("status").textContent).toContain("ana@correo.com");
    expect(button().disabled).toBe(true); // cooling down again
  });
  it("shows the error and does not start a cooldown when it fails", async () => {
    resend.mockResolvedValue({ error: { message: "boom" } });
    render(<ResendConfirmation email="ana@correo.com" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "No pudimos reenviar el correo"
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});

describe("3 · login errors in Spanish", () => {
  async function login(error: { code?: string; message: string }) {
    signInWithPassword.mockResolvedValue({ error });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Correo"), {
      target: { value: "ana@correo.com" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "secreto1" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    });
  }
  it("email_not_confirmed → the message and «Reenviar correo de confirmación»", async () => {
    await login({
      code: "email_not_confirmed",
      message: "Email not confirmed",
    });
    expect(
      await screen.findByText(
        "Tu correo aún no está confirmado. Revisa tu bandeja (y spam)."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Reenviar correo de confirmación/ })
    ).toBeTruthy();
  });
  it("falls back to matching the message when the code is missing", async () => {
    await login({ message: "Email not confirmed" });
    expect(await screen.findByText(/aún no está confirmado/)).toBeTruthy();
  });
  it("invalid credentials → «Correo o contraseña incorrectos.» and no resend offer", async () => {
    await login({
      code: "invalid_credentials",
      message: "Invalid login credentials",
    });
    expect(
      await screen.findByText("Correo o contraseña incorrectos.")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reenviar/ })).toBeNull();
  });
  it("the callback's ?error=link_failed shows the Spanish message and the resend option", () => {
    search = "error=link_failed";
    render(<LoginForm />);
    expect(
      screen.getByText(/No pudimos confirmar tu correo con ese enlace/)
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Reenviar correo de confirmación/ })
    ).toBeTruthy();
  });
});
