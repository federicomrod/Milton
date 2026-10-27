// Restaurant pages no longer sit inside the legacy CFO client layout.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(process.cwd(), "app/dashboard/layout.tsx"),
  "utf8"
);

describe("dashboard layout on restaurant pages", () => {
  it("is a server passthrough: no client session, KPIs, chat or data-status", () => {
    expect(src).not.toContain('"use client"');
    expect(src).not.toContain("ensureSession");
    expect(src).not.toContain("/api/kpis/");
    expect(src).not.toContain("/api/data/status");
    expect(src).not.toContain("miltonchat");
    expect(src).not.toContain("useUser");
    expect(src).toContain("return children");
  });

  it("root providers are ThemeProvider only; prefs live on Ajustes", () => {
    const providers = readFileSync(
      join(process.cwd(), "components/layout/client-providers.tsx"),
      "utf8"
    );
    expect(providers).toContain("ThemeProvider");
    expect(providers).not.toContain("UserProvider");
    expect(providers).not.toContain("UserPreferencesProvider");
    expect(providers).not.toContain("BusinessProvider");
    const settings = readFileSync(
      join(process.cwd(), "app/dashboard/settings/layout.tsx"),
      "utf8"
    );
    expect(settings).toContain("SettingsPreferencesProviders");
  });

  it("the leftover CFO routes and chat helper are gone", () => {
    for (const f of [
      "app/api/kpis/calculate/route.ts",
      "app/api/kpis/selected/route.ts",
      "app/api/data/status/route.ts",
      "app/api/business-type/route.ts",
      "app/api/chat/route.ts",
      "components/dashboard/miltonchat.tsx",
      "lib/dashboard-kpis-server.ts",
      "lib/dashboard-kpis.ts",
      "lib/ai/dashboard-context.ts",
    ]) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(false);
    }
  });
});
