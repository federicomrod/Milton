import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CONNECT_DATA_PATH,
  MANAGEMENT_DASHBOARD_PATH,
  ONBOARDING_WIZARD_PATH,
  RESTAURANT_DASHBOARD_PATH,
  getPostLoginRedirect,
  landingForOnboardingStatus,
  safeNextPath,
} from "@/lib/restaurant/post-login";

describe("landingForOnboardingStatus", () => {
  it("sends finished self-serve users to the restaurant dashboard", () => {
    expect(landingForOnboardingStatus("completed")).toBe(
      RESTAURANT_DASHBOARD_PATH
    );
  });

  it("sends unfinished self-serve users to the wizard", () => {
    expect(landingForOnboardingStatus("not_started")).toBe(
      ONBOARDING_WIZARD_PATH
    );
    expect(landingForOnboardingStatus(null)).toBe(ONBOARDING_WIZARD_PATH);
    expect(landingForOnboardingStatus(undefined)).toBe(ONBOARDING_WIZARD_PATH);
    expect(landingForOnboardingStatus("")).toBe(ONBOARDING_WIZARD_PATH);
  });
});

function fakeSupabase(opts: {
  user?: { id: string } | null;
  isAdmin?: boolean | "error";
  companyId?: string | null;
  invited?: boolean | "error";
  onboardingStatus?: string | null;
  onboardingLookupError?: boolean;
  throwOnAuth?: boolean;
  conns?: number;
  sales?: number;
}) {
  const user = opts.user === undefined ? { id: "user-1" } : opts.user;
  const companyId = opts.companyId === undefined ? "company-1" : opts.companyId;

  return {
    auth: {
      getUser: async () => {
        if (opts.throwOnAuth) throw new Error("auth exploded");
        return { data: { user } };
      },
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "is_milton_admin") {
        if (opts.isAdmin === "error") {
          return { data: null, error: { message: "rpc failed" } };
        }
        return { data: opts.isAdmin === true, error: null };
      }
      if (name === "current_user_was_invited") {
        if (opts.invited === "error") {
          return { data: null, error: { message: "rpc failed" } };
        }
        return { data: opts.invited === true, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${name}` } };
    }),
    from: (table: string) => {
      let selectCols = "";
      const q: Record<string, unknown> = {};
      q.select = (cols: string) => {
        selectCols = cols;
        return q;
      };
      q.eq = () => q;
      q.maybeSingle = async () => {
        if (table === "companies" && selectCols === "id") {
          return {
            data: null,
            error: { message: "column created_by does not exist" },
          };
        }
        if (table === "profiles") {
          return {
            data: companyId ? { company_id: companyId } : null,
            error: null,
          };
        }
        if (table === "company_memberships") {
          return {
            data: companyId ? { company_id: companyId } : null,
            error: null,
          };
        }
        if (table === "companies" && selectCols.includes("onboarding_status")) {
          if (opts.onboardingLookupError) {
            return { data: null, error: { message: "lookup failed" } };
          }
          return {
            data: { onboarding_status: opts.onboardingStatus ?? null },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      q.then = (resolve: (v: unknown) => void) => {
        const count =
          table === "restaurant_pos_connections"
            ? (opts.conns ?? 0)
            : table === "pos_sales_items"
              ? (opts.sales ?? 0)
              : 0;
        resolve({ count, error: null });
      };
      return q;
    },
  } as never;
}

describe("getPostLoginRedirect", () => {
  it("a Milton admin with a completed company lands on the Cockpit (was /management/dashboard)", async () => {
    const supabase = fakeSupabase({
      isAdmin: true,
      onboardingStatus: "completed",
      invited: false,
    });
    const path = await getPostLoginRedirect(supabase);
    expect(path).toBe(RESTAURANT_DASHBOARD_PATH);
    expect(path).not.toBe(MANAGEMENT_DASHBOARD_PATH);
    // the admin check is not part of the landing any more
    expect(
      (
        supabase as never as { rpc: { mock: { calls: unknown[][] } } }
      ).rpc.mock.calls.some((c) => c[0] === "is_milton_admin")
    ).toBe(false);
  });

  it("an admin follows the same rules as everyone else (unfinished onboarding → wizard)", async () => {
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ isAdmin: true, onboardingStatus: "not_started" })
      )
    ).toBe(ONBOARDING_WIZARD_PATH);
  });

  it("an admin without a company lands on the Cockpit", async () => {
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ isAdmin: true, companyId: null })
      )
    ).toBe(RESTAURANT_DASHBOARD_PATH);
  });

  it("keeps the invited-user landing rule", async () => {
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ invited: true, conns: 0, sales: 0 })
      )
    ).toBe(CONNECT_DATA_PATH);
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ invited: true, conns: 1, sales: 0 })
      )
    ).toBe(RESTAURANT_DASHBOARD_PATH);
  });

  it("sends a finished self-serve user to the restaurant dashboard", async () => {
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ invited: false, onboardingStatus: "completed" })
      )
    ).toBe(RESTAURANT_DASHBOARD_PATH);
  });

  it("sends a brand-new self-serve user to the wizard", async () => {
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ invited: false, onboardingStatus: "not_started" })
      )
    ).toBe(ONBOARDING_WIZARD_PATH);
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ invited: false, onboardingStatus: null })
      )
    ).toBe(ONBOARDING_WIZARD_PATH);
  });

  it("falls back to the dashboard when there is no user or no company", async () => {
    expect(await getPostLoginRedirect(fakeSupabase({ user: null }))).toBe(
      RESTAURANT_DASHBOARD_PATH
    );
    expect(await getPostLoginRedirect(fakeSupabase({ companyId: null }))).toBe(
      RESTAURANT_DASHBOARD_PATH
    );
  });

  it("does not block login when auth lookup throws", async () => {
    expect(
      await getPostLoginRedirect(fakeSupabase({ throwOnAuth: true }))
    ).toBe(RESTAURANT_DASHBOARD_PATH);
  });

  it("treats a failed onboarding_status select as unfinished (wizard)", async () => {
    expect(
      await getPostLoginRedirect(
        fakeSupabase({ invited: false, onboardingLookupError: true })
      )
    ).toBe(ONBOARDING_WIZARD_PATH);
  });
});

describe("safeNextPath", () => {
  it("accepts a same-origin relative path (the proxy still guards /management)", () => {
    expect(safeNextPath("/dashboard/restaurant/platos")).toBe(
      "/dashboard/restaurant/platos"
    );
    expect(safeNextPath("/management/dashboard")).toBe("/management/dashboard");
    expect(safeNextPath("/dashboard/restaurant/menu?producto=7&tab=a#x")).toBe(
      "/dashboard/restaurant/menu?producto=7&tab=a#x"
    );
  });
  it("rejects empty, absolute, protocol-relative, backslash and scheme values", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "dashboard",
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "javascript:alert(1)",
      "/%5Cevil.com",
      "/%2F/evil.com",
      "/path\nnewline",
      "/path\u0000nul",
      "/x\ty",
    ]) {
      expect(safeNextPath(bad as string | null), String(bad)).toBeNull();
    }
  });
  it("rejects /auth/* so a login cannot loop", () => {
    for (const bad of [
      "/auth/login",
      "/auth/login?next=/x",
      "/auth",
      "/auth/callback?code=1",
      "/AUTH/login",
      "/%61uth/login",
    ]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
    // a path that merely starts with the letters is fine
    expect(safeNextPath("/authors")).toBe("/authors");
  });
});

describe("the wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("login form (3 places), callback and proxy use safeNextPath", () => {
    const form = read("components/auth/login-form.tsx");
    // the three push sites (two hash-link branches and the password submit)
    expect(
      (
        form.match(
          /\?\?\s*\(\s*await getPostLoginRedirect\(supabase\)\s*\)/g
        ) ?? []
      ).length
    ).toBe(3);
    expect((form.match(/safeNextPath\(/g) ?? []).length).toBeGreaterThanOrEqual(
      3
    );
    expect(form).toContain('get("next")');
    expect(read("app/auth/callback/route.ts")).toContain(
      'safeNextPath(params.get("next"))'
    );
    const proxy = read("proxy.ts");
    expect(proxy).toContain('redirectUrl.searchParams.set("next", next)');
    // /management stays admin-only: the proxy's own guard is untouched
    expect(proxy).toContain("/management");
  });
  it("«Administración» is shown only for Milton admins", () => {
    const shell = read("components/restaurant/RestaurantShell.tsx");
    expect(shell).toMatch(
      /\{isAdmin \? \(\s*<Link\s+href="\/management\/dashboard"/
    );
    expect(shell).toContain("Administración");
  });
});
