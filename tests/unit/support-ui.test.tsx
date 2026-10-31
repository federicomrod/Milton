import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/dashboard/restaurant/support-actions", () => ({
  exitSupportAction: async () => ({ ok: true }),
  switchCompanyAction: async () => ({ ok: true }),
  openClientAccountAction: async () => ({ ok: true }),
}));

import { I18nProvider } from "@/lib/i18n/client";
import { RestaurantShellChromeProvider } from "@/components/restaurant/shell/shell-chrome-context";
import { SupportBanner } from "@/components/restaurant/shell/SupportBanner";
import { CompanyList } from "@/components/restaurant/shell/CompanySwitcher";
import { ClientsList } from "@/components/management/clients-list";
import type { PreferredLanguage } from "@/lib/restaurant/language";

const wrap = (
  lang: PreferredLanguage,
  chrome: Record<string, unknown>,
  child: React.ReactElement
) =>
  renderToStaticMarkup(
    <I18nProvider lang={lang}>
      <RestaurantShellChromeProvider
        value={{ lang, isAdmin: true, lastSyncedAt: null, ...chrome }}
      >
        {child}
      </RestaurantShellChromeProvider>
    </I18nProvider>
  );

describe("the support banner", () => {
  it.each([
    ["es", "Modo soporte · Demo Resto", "Salir"],
    ["en", "Support mode · Demo Resto", "Exit"],
    ["de", "Support-Modus · Demo Resto", "Beenden"],
  ] as const)("%s", (lang, text, exit) => {
    const html = wrap(
      lang,
      { supportCompanyName: "Demo Resto" },
      createElement(SupportBanner)
    );
    expect(html).toContain(text);
    expect(html).toContain(`>${exit}<`);
    expect(html).toContain('data-testid="support-banner"');
  });
  it("is absent outside support mode", () => {
    expect(wrap("es", {}, createElement(SupportBanner))).toBe("");
  });
});

describe("the company switcher", () => {
  const companies = [
    { id: "a", name: "Los Ranchos", isSupport: false },
    { id: "b", name: "Demo Resto", isSupport: true },
  ];
  it("lists every company when there are two or more, marking support", () => {
    const html = wrap(
      "es",
      { companies, activeCompanyId: "b" },
      createElement(CompanyList)
    );
    expect(html).toContain("Los Ranchos");
    expect(html).toContain("Demo Resto");
    expect(html).toContain("Soporte");
  });
  it("shows nothing for a normal user with one company", () => {
    expect(
      wrap(
        "es",
        { companies: companies.slice(0, 1) },
        createElement(CompanyList)
      )
    ).toBe("");
  });
});

describe("Administración › Clientes", () => {
  it("has «Abrir cuenta» for each company, the active one marked, and the last opens", () => {
    const html = wrap(
      "es",
      {},
      createElement(ClientsList, {
        companies: [
          { id: "a", name: "Los Ranchos" },
          { id: "b", name: "Demo Resto" },
        ],
        loadFailed: false,
        activeCompanyId: "a",
        opens: [
          {
            id: "o1",
            companyId: "b",
            companyName: "Demo Resto",
            userEmail: "fede@milton.test",
            openedAt: "2026-10-30T10:00:00Z",
          },
        ],
      })
    );
    expect(html.match(/Abrir cuenta/g)).toHaveLength(1);
    expect(html).toContain("Cuenta activa");
    expect(html).toContain("Accesos recientes");
    expect(html).toContain("fede@milton.test");
  });
});
