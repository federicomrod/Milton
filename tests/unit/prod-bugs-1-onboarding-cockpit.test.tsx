// Prod bugs 1, items 5 and 6: onboarding in the restaurant shell (Spanish) and
// the empty Cockpit = Cockpit v2 with no made-up numbers.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CockpitEmpty } from "@/components/restaurant/cockpit/v2/CockpitEmpty";
import {
  COUNTRY_OPTIONS,
  CONCEPT_TYPE_OPTIONS,
  ONBOARDING_COPY,
  POS_SYSTEM_OPTIONS,
  PRIORITY_OPTIONS,
  getNextStepCards,
} from "@/lib/restaurant/onboarding-copy";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

describe("5 · onboarding uses the restaurant shell, not the old top bar", () => {
  it("there is no old top navigation bar any more: every page has the shell, its own chrome or none", () => {
    expect(
      existsSync(join(process.cwd(), "components/layout/app-navigation.tsx"))
    ).toBe(false);
    expect(read("app/layout.tsx")).not.toContain("AppNavigation");
  });
  it("the restaurant onboarding page wraps the wizard in RestaurantShell (slim: no sections or switcher yet)", () => {
    const page = read("app/onboarding/restaurant/page.tsx");
    expect(page).toContain("<RestaurantShell");
    expect(page).toContain("slim");
    expect(page).toContain("loadRestaurantShellChrome");
    const shell = read("components/restaurant/RestaurantShell.tsx");
    expect(shell).toContain("SlimSidebar");
    expect(shell).toContain("Configuración inicial");
  });
  it("all the onboarding copy is Spanish (tú)", () => {
    const strings: string[] = [];
    const walk = (o: unknown) => {
      if (typeof o === "string") strings.push(o);
      else if (o && typeof o === "object") Object.values(o).forEach(walk);
    };
    walk(ONBOARDING_COPY);
    for (const list of [
      CONCEPT_TYPE_OPTIONS,
      POS_SYSTEM_OPTIONS,
      PRIORITY_OPTIONS,
      COUNTRY_OPTIONS,
    ])
      list.forEach((o) => strings.push(o.label));
    for (const pos of ["odoo", "unknown", "other", "toast"] as const)
      for (const c of getNextStepCards(pos))
        strings.push(c.title, c.description, c.cta);
    const all = strings.join(" | ");
    for (const english of [
      "Your place",
      "Your operation",
      "Let's",
      "Pick up to",
      "Select a country",
      "Recommended",
      "Back",
      "Next",
      "Skip",
      "Upload",
      "Connect my POS",
      "Add recipes",
      "I don't know",
      "Understand my margins",
      "Setting up",
    ])
      expect(all, english).not.toContain(english);
    expect(ONBOARDING_COPY.step4.heading).toBe(
      "Milton está listo para {restaurantName}."
    );
    const wizard = read(
      "components/restaurant/onboarding/RestaurantOnboardingWizard.tsx"
    );
    expect(wizard).not.toMatch(
      /Skip to dashboard|Recommended|Could not finish/
    );
  });
  it("the legacy onboarding steps are gone; /onboarding redirects to the restaurant wizard", () => {
    for (const d of [
      "chat",
      "data-sources",
      "kpi-selection",
      "upload",
      "model",
    ])
      expect(
        existsSync(join(process.cwd(), `app/onboarding/${d}/page.tsx`)),
        d
      ).toBe(false);
    const layout = read("app/onboarding/layout.tsx");
    expect(layout).not.toContain("use client");
    expect(layout).not.toContain("getOnboardingStatus");
    expect(layout).not.toContain("Loading...");
    expect(read("app/onboarding/page.tsx")).toContain(
      'redirect("/onboarding/restaurant")'
    );
  });
});

describe("6 · the empty Cockpit is Cockpit v2 with no numbers", () => {
  const html = renderToString(
    createElement(CockpitEmpty, { reason: "no_sales" })
  );
  const t = text(html);
  it("has the Cockpit v2 structure: periods, comparison, four cards, ranges, daily chart, mix, weeks, cost per day, Milton", () => {
    for (const l of [
      "Hoy",
      "7 d",
      "30 d",
      "Trimestre",
      "Comparar con",
      "Venta promedio diaria",
      "Ventas · 30 d",
      "Costo de comida",
      "Margen bruto",
      "Ventas diarias",
      "Mezcla de ventas",
      "Semana vs semana",
      "Costo de comida por día",
      "✦ Milton",
    ])
      expect(t, l).toContain(l);
  });
  it("every figure is «—» or «Sin datos aún»; nothing is $0 or a made-up number", () => {
    expect(t).toContain("—");
    expect(t).toContain("Sin datos aún");
    expect(t).not.toMatch(/[$€£]/);
    expect(t).not.toMatch(/\d+[.,]?\d*\s?%/);
    expect(t).not.toContain("MXN");
    expect(t).not.toMatch(/\b\d{3,}\b/); // no 397,400-style figure
    for (const mock of [
      "BBQ",
      "Rentabilidad por platillo",
      "Dish Profitability",
      "397",
      "Total Revenue",
    ])
      expect(t).not.toContain(mock);
  });
  it("tells you what to do: Conecta tu POS → connect-data, Sube tus costos → Costos", () => {
    expect(html).toContain('href="/dashboard/restaurant/connect-data"');
    expect(html).toContain('href="/dashboard/restaurant/costs"');
    expect(t).toContain("Conecta tu POS");
    expect(t).toContain("Sube tus costos");
  });
  it("says why, per reason, in Spanish", () => {
    expect(
      text(
        renderToString(
          createElement(CockpitEmpty, { reason: "supabase_error" })
        )
      )
    ).toContain("No pudimos leer tus ventas");
    expect(
      text(
        renderToString(createElement(CockpitEmpty, { reason: "no_company" }))
      )
    ).toContain("todavía no está ligada");
    expect(
      text(
        renderToString(
          createElement(CockpitEmpty, { reason: "unauthenticated" })
        )
      )
    ).toContain("Entra a tu cuenta");
  });
  it("the page has no mock / sample path any more, no MXN default; the mock data file is gone", () => {
    const page = read("app/dashboard/restaurant/(cockpit)/page.tsx");
    for (const gone of [
      "SampleRestaurantView",
      "mock-data",
      "MOCK_",
      'makeFmts("MXN")',
      "MXN",
      "Showing sample data",
    ])
      expect(page, gone).not.toContain(gone);
    expect(page).toContain("<CockpitEmpty");
    expect(page).toContain('fast.mode !== "live"');
    expect(existsSync(join(process.cwd(), "lib/restaurant/mock-data.ts"))).toBe(
      false
    );
  });
  it("the empty Cockpit adds no query: it renders from the fast model the page already loaded", () => {
    const empty = read("components/restaurant/cockpit/v2/CockpitEmpty.tsx");
    expect(empty).not.toMatch(/createClient|fetch\(|await /);
  });
});
