// Cuenta / Ajustes live in the restaurant shell (no old top bar); old CFO
// pages redirect to their restaurant equivalent; the company name is read
// through the membership. Synthetic data only.
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { legacyRedirectTarget } from "@/lib/restaurant/legacy-redirects";
import {
  PRIMARY_NAV_ITEMS,
  isPrimaryNavActive,
} from "@/lib/restaurant/navigation";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("old CFO pages redirect to their restaurant equivalent", () => {
  it.each([
    ["/dashboard", "/dashboard/restaurant"],
    ["/dashboard/model", "/dashboard/restaurant"],
    ["/dashboard/analytics", "/dashboard/restaurant/sales"],
    ["/dashboard/reporting", "/dashboard/restaurant"],
    ["/dashboard/scenarios", "/dashboard/restaurant"],
    ["/dashboard/scenarios/abc/edit", "/dashboard/restaurant"],
    ["/dashboard/data", "/dashboard/restaurant/data?tab=conexiones"],
    ["/dashboard/upload", "/dashboard/restaurant/data?tab=conexiones"],
  ])("%s → %s", (from, to) => {
    expect(legacyRedirectTarget(from)).toBe(to);
  });
  it("leaves the restaurant app, account and settings alone", () => {
    for (const p of [
      "/dashboard/restaurant",
      "/dashboard/restaurant/data",
      "/dashboard/restaurant/sales",
      "/dashboard/account",
      "/dashboard/settings",
      "/management/dashboard",
      "/auth/login",
    ])
      expect(legacyRedirectTarget(p), p).toBeNull();
  });
  it("proxy.ts uses it before the onboarding gate", () => {
    const proxy = read("proxy.ts");
    expect(proxy).toContain("legacyRedirectTarget(pathname)");
    expect(proxy.indexOf("legacyRedirectTarget(pathname)")).toBeLessThan(
      proxy.indexOf("needsOnboardingGate")
    );
  });
});

describe("the old top navigation is gone", () => {
  it("account and settings have the shell layout; Configuración stays highlighted there", () => {
    for (const page of ["account", "settings"]) {
      const layout = read(`app/dashboard/${page}/layout.tsx`);
      expect(layout).toContain("RestaurantShellLayout");
    }
    const settings = PRIMARY_NAV_ITEMS.find((i) => i.id === "data_settings")!;
    expect(isPrimaryNavActive(settings, "/dashboard/account")).toBe(true);
    expect(isPrimaryNavActive(settings, "/dashboard/settings")).toBe(true);
    expect(isPrimaryNavActive(settings, "/dashboard/restaurant/sales")).toBe(
      false
    );
  });
  it("the legacy dashboard wrapper is a passthrough (no chat bubble)", () => {
    const layout = read("app/dashboard/layout.tsx");
    expect(layout).not.toContain('"use client"');
    expect(layout).not.toContain("miltonchat");
    expect(layout).toContain("return children");
  });
});

describe("Cuenta and Ajustes pages", () => {
  const account = read("app/dashboard/account/page.tsx");
  const settings = read("app/dashboard/settings/page.tsx");
  it("keep their content and drop the two buttons that were disabled forever", () => {
    expect(read("lib/i18n/es/settings.ts")).toContain("Estado de la cuenta");
    for (const heading of ["TelegramConnectionCard", "EmailBriefingCard"])
      expect(account).toContain(heading);
    expect(account).not.toContain("Información de la empresa");
    expect(settings).toContain("d.settings.page.companyInfo");
    expect(read("lib/i18n/es/settings.ts")).toContain(
      "Información de la empresa"
    );
    expect(account).not.toContain("Administrar facturación");
    expect(account).not.toContain('href="/dashboard">');
  });
  it("Ajustes is in Spanish", () => {
    expect(read("lib/i18n/es/common.ts")).toContain("Guardar");
    expect(settings).toContain("d.common.save");
    expect(settings).not.toMatch(/Save Preferences|Company Name|Timezone/);
  });
  it("primary buttons are brand blue (not black), secondary are white with a blue border", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/--primary: oklch\(0\.45 0\.2 264\)/);
    const button = read("components/ui/button.tsx");
    expect(button).toContain("bg-primary text-primary-foreground");
    expect(button).toMatch(/outline:\s*"border border-\[#1B40C8\] bg-white/);
  });
});

describe("company name", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("getUserCompany reads it through the membership API, not companies.created_by", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ company: { id: "c1", name: "Demo Resto" } }),
      }))
    );
    const { getUserCompany } = await import("@/lib/profile-service");
    expect((await getUserCompany())?.name).toBe("Demo Resto");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "/api/restaurant/company"
    );
  });
  it("the API resolves the company from auth and never from the request", () => {
    const route = read("app/api/restaurant/company/route.ts");
    expect(route).toContain("authAndCompany");
    expect(route).toContain('.eq("id", auth.companyId)');
    expect(route).not.toContain("searchParams");
  });
});
