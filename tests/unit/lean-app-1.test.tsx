// Lean copy pass 1: each piece of content is said once. Synthetic data only.
import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {} }),
  usePathname: () => "/dashboard/restaurant",
  useSearchParams: () => new URLSearchParams(),
}));
// The Ask Milton page is an async server component that reads the company's
// language; here the company has not chosen one, so it is the Spanish default.
vi.mock("@/lib/restaurant/shell-context-server", () => ({
  loadRestaurantShellChrome: async () => ({ lang: "es" }),
}));
vi.mock("@/components/restaurant/AskMiltonWorkspace", () => ({
  AskMiltonWorkspace: () => null,
}));

import {
  CockpitV2,
  type CockpitV2Props,
} from "@/components/restaurant/cockpit/v2/CockpitV2";
import {
  CockpitEmpty,
  type EmptyReason,
} from "@/components/restaurant/cockpit/v2/CockpitEmpty";
import AskMiltonPage from "@/app/dashboard/restaurant/briefing/page";
import { eachDay } from "@/lib/restaurant/cockpit-math";
import { NOT_AVAILABLE_YET, READ_MENU_LABEL } from "@/lib/restaurant/ui-copy";

const REF = "2026-10-14";
const props: CockpitV2Props = {
  currency: "USD",
  daily: eachDay("2026-04-01", REF).map((date, i) => ({
    date,
    net_sales: 1000 + (i % 7) * 100,
    tickets: 40,
  })),
  refDay: REF,
  today: "2026-10-15",
  firstDay: "2026-04-01",
  targets: [],
  restaurants: [{ id: "r1", name: "Uno" }],
  locationId: null,
  defaultComparison: "months_6",
};
const clean = (html: string) => html.replace(/<!-- -->/g, "");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Cockpit", () => {
  const html = clean(renderToString(createElement(CockpitV2, props)));
  it("says each thing once", () => {
    for (const gone of [
      "Verde = sobre objetivo",
      "clic = filtrar todo",
      "del objetivo del periodo",
      "clic en un día para ver el detalle",
    ])
      expect(html).not.toContain(gone);
    expect(html).toContain("Ventas diarias");
    expect(html).not.toContain("Ventas diarias vs");
    expect(html).toContain("Sin objetivo de ventas.");
  });
  it("the empty states are short and have no developer text", () => {
    for (const reason of [
      "no_sales",
      "env_missing",
      "supabase_error",
    ] as EmptyReason[]) {
      const empty = clean(
        renderToString(createElement(CockpitEmpty, { reason }))
      );
      expect(empty).not.toContain("ambiente");
      expect(empty).not.toContain("Con tus ventas y tus costos");
      expect(empty.split("Sube tus costos para calcularlo")).toHaveLength(2);
    }
    const env = renderToString(
      createElement(CockpitEmpty, { reason: "env_missing" })
    );
    expect(env).toContain(NOT_AVAILABLE_YET);
  });
});

describe("Preguntar a Milton", () => {
  it("has a Spanish title and no English subtitle", async () => {
    const html = renderToString(await AskMiltonPage());
    expect(html).toContain("Preguntar a Milton");
    expect(html).not.toContain("Ask questions about");
  });
});

describe("Cuenta, Ajustes and Configuración", () => {
  it("Cuenta has no «Acciones rápidas» card or descriptions", () => {
    const src = read("app/dashboard/account/page.tsx");
    expect(src).not.toContain("Acciones rápidas");
    expect(src).not.toContain("Tu suscripción y datos de facturación");
  });
  it("Ajustes has no repeated descriptions", () => {
    const src = read("app/dashboard/settings/page.tsx");
    for (const gone of [
      "Datos básicos de tu empresa",
      "Cómo se ve la app",
      "Usar el tema claro en toda la app",
    ])
      expect(src).not.toContain(gone);
  });
  it("Configuración tabs have no subtitles", () => {
    const src = read("app/dashboard/restaurant/data/page.tsx");
    expect(src).not.toContain("subtitle(");
    expect(src).not.toContain("De dónde vienen tus ventas");
  });
});

describe("developer messages", () => {
  it("no UI file in this pass mentions a migration or «en este ambiente»", () => {
    for (const file of [
      "components/restaurant/settings/TurnosForm.tsx",
      "components/restaurant/settings/ObjetivosForm.tsx",
      "components/restaurant/settings/RestaurantNamesForm.tsx",
      "components/restaurant/cockpit/v2/CockpitEmpty.tsx",
      "app/dashboard/restaurant/costs/page.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/migración \d{3}/);
      expect(src, file).not.toContain("en este ambiente");
    }
  });
  it("the shared strings are in one place", () => {
    expect(NOT_AVAILABLE_YET).toBe("Esto aún no está disponible en tu cuenta.");
    expect(READ_MENU_LABEL).toBe("Leer tu menú →");
  });
});
