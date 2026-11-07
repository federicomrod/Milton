import { beforeEach, describe, expect, it, vi } from "vitest";

let user: { id: string; email: string } | null = {
  id: "u1",
  email: "fede@milton.test",
};
let isAdmin = true;
const open = vi.fn(async () => ({
  ok: true as const,
  companyId: "c",
  companyName: "Demo Resto",
}));
const sw = vi.fn(async () => true);
const exit = vi.fn(async () => "home");

vi.mock("@/lib/restaurant/auth-user", () => ({
  getCachedAuthUser: async () => user,
  getCachedIsMiltonAdmin: async () => isAdmin,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/support/support-access", () => ({
  openClientAccount: (...a: unknown[]) => open(...(a as [])),
  switchActiveCompany: (...a: unknown[]) => sw(...(a as [])),
  exitSupportMode: (...a: unknown[]) => exit(...(a as [])),
}));

import {
  exitSupportAction,
  openClientAccountAction,
  switchCompanyAction,
} from "@/app/dashboard/restaurant/support-actions";

const CO = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  user = { id: "u1", email: "fede@milton.test" };
  isAdmin = true;
  open.mockClear();
  sw.mockClear();
  exit.mockClear();
});

describe("«Abrir cuenta» is for Milton admins only", () => {
  it("a normal user is refused and nothing is opened", async () => {
    isAdmin = false;
    expect(await openClientAccountAction(CO)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(open).not.toHaveBeenCalled();
  });
  it("a signed-out caller is refused", async () => {
    user = null;
    expect(await openClientAccountAction(CO)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
  it("a Milton admin opens a valid company, as themselves", async () => {
    expect(await openClientAccountAction(CO)).toEqual({
      ok: true,
      companyName: "Demo Resto",
    });
    expect(open).toHaveBeenCalledWith(
      {},
      { userId: "u1", userEmail: "fede@milton.test", companyId: CO }
    );
  });
  it("a malformed id never reaches the database", async () => {
    expect(await openClientAccountAction("nope")).toEqual({
      ok: false,
      error: "company",
    });
    expect(open).not.toHaveBeenCalled();
  });
});

describe("the switcher and «Salir»", () => {
  it("switch uses the signed-in user, never a client-supplied one", async () => {
    expect((await switchCompanyAction(CO)).ok).toBe(true);
    expect(sw).toHaveBeenCalledWith({}, "u1", CO);
    sw.mockResolvedValueOnce(false);
    expect(await switchCompanyAction(CO)).toEqual({
      ok: false,
      error: "failed",
    });
  });
  it("exit goes home, or fails when there is no home", async () => {
    expect((await exitSupportAction()).ok).toBe(true);
    exit.mockResolvedValueOnce(null as unknown as string);
    expect(await exitSupportAction()).toEqual({ ok: false, error: "failed" });
  });
});
