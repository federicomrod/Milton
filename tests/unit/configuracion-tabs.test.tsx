// Configuración is ONE scrolling page: every section expanded on load, no
// tabs. Old ?tab= links and the old /data/* routes still land on a section.
// Synthetic data only.
import { readFileSync } from "fs";
import { join } from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
}));
vi.mock("@/lib/restaurant/shell-context-server", () => ({
  loadRestaurantShellChrome: async () => ({ lang: "es", isAdmin: false }),
}));
vi.mock("@/components/restaurant/shell/OperatingPageHeader", () => ({
  OperatingPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
for (const name of [
  "Ajustes",
  "Restaurantes",
  "Conexiones",
  "Objetivos",
  "Turnos",
  "Equipo",
  "Cuenta",
]) {
  vi.doMock(`@/components/restaurant/config/sections/${name}Section`, () => ({
    [`${name}Section`]: (props: Record<string, unknown>) => (
      <div
        data-testid={`body-${name}`}
      >{`${name}:${JSON.stringify(props)}`}</div>
    ),
  }));
}

import { configTabHref, parseConfigTab } from "@/lib/restaurant/config-tabs";
import RestaurantRedirect from "@/app/dashboard/restaurant/data/restaurante/page";
import ObjetivosRedirect from "@/app/dashboard/restaurant/data/objetivos/page";
import TurnosRedirect from "@/app/dashboard/restaurant/data/turnos/page";
import SettingsRedirect from "@/app/dashboard/settings/page";
import AccountRedirect from "@/app/dashboard/account/page";

async function html(params: Record<string, string> = {}) {
  const { default: ConfiguracionPage } =
    await import("@/app/dashboard/restaurant/data/page");
  const el = await ConfiguracionPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  redirect.mockClear();
});

describe("one page, all sections expanded", () => {
  it("renders the seven cards in order, each with its anchor id and a title", async () => {
    const out = await html();
    const ids = [
      "ajustes",
      "restaurantes",
      "conexiones",
      "objetivos",
      "turnos",
      "equipo",
      "cuenta",
    ];
    let last = -1;
    for (const id of ids) {
      const at = out.indexOf(`id="${id}"`);
      expect(at, id).toBeGreaterThan(last);
      last = at;
      expect(out).toContain(`data-testid="config-${id}"`);
    }
    for (const title of [
      "Ajustes",
      "Restaurantes",
      "Conexiones",
      "Objetivos",
      "Turnos",
      "Equipo y acceso",
      "Mi cuenta",
    ])
      expect(out).toContain(`>${title}</h2>`);
  });

  it("has an index (desktop) and a chip row (mobile) with one link per section, and no tab bar", async () => {
    const out = await html();
    expect(out).toContain('data-testid="config-index"');
    expect(out).toContain('data-testid="config-chips"');
    expect(out.match(/href="#ajustes"/g)).toHaveLength(2);
    expect(out.match(/href="#cuenta"/g)).toHaveLength(2);
    expect(out).not.toContain("?tab=");
  });

  it("passes the location, the «aplica a» choice and the upload flag to their sections", async () => {
    const out = await html({ location: "l1", aplica: "l2" });
    expect(out).toContain("Restaurantes:{&quot;location&quot;:&quot;l1&quot;}");
    expect(out).toContain("Objetivos:{&quot;aplica&quot;:&quot;l2&quot;}");
    const upload = await html({ seccion: "conexiones" });
    expect(upload).toContain("Conexiones:{&quot;uploadOpen&quot;:true}");
    expect(await html()).toContain("Conexiones:{&quot;uploadOpen&quot;:false}");
  });
});

describe("which section an old URL asks for", () => {
  it("?tab= wins, the older ?seccion= still works", () => {
    expect(parseConfigTab({ tab: "cuenta" }, false)).toBe("cuenta");
    expect(parseConfigTab({ seccion: "turnos" }, false)).toBe("turnos");
    expect(parseConfigTab({ tab: "objetivos", seccion: "turnos" }, false)).toBe(
      "objetivos"
    );
    expect(configTabHref("turnos")).toBe(
      "/dashboard/restaurant/data?tab=turnos"
    );
  });
});

describe("old routes land on Configuración, keeping the other params", () => {
  const go = async (
    page: typeof RestaurantRedirect,
    params: Record<string, string>
  ) => {
    await expect(
      page({ searchParams: Promise.resolve(params) })
    ).rejects.toThrow(/REDIRECT:/);
    return redirect.mock.calls[0][0] as string;
  };
  it("/data/restaurante, /data/objetivos, /data/turnos", async () => {
    expect(await go(RestaurantRedirect, { location: "l1" })).toBe(
      "/dashboard/restaurant/data?location=l1&tab=restaurante"
    );
    redirect.mockClear();
    expect(await go(ObjetivosRedirect, { aplica: "l2" })).toBe(
      "/dashboard/restaurant/data?aplica=l2&tab=objetivos"
    );
    redirect.mockClear();
    expect(await go(TurnosRedirect, {})).toBe(
      "/dashboard/restaurant/data?tab=turnos"
    );
  });
  it("/dashboard/settings → Ajustes and /dashboard/account → Mi cuenta", () => {
    expect(() => SettingsRedirect()).toThrow(
      "REDIRECT:/dashboard/restaurant/data?tab=ajustes"
    );
    expect(() => AccountRedirect()).toThrow(
      "REDIRECT:/dashboard/restaurant/data?tab=cuenta"
    );
  });
});

describe("source rules", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("«Aplica a» stays on the page: it replaces ?aplica= and keeps #objetivos in view", () => {
    const src = read("components/restaurant/settings/AppliesTo.tsx");
    expect(src).toContain('"aplica"');
    expect(src).toContain("#objetivos");
    expect(src).toContain("scroll: false");
    expect(src).not.toContain("router.push");
    expect(src).not.toContain("?tab=objetivos");
  });
  it("no red, green or orange classes in the Configuración files", () => {
    for (const f of [
      "app/dashboard/restaurant/data/page.tsx",
      "components/restaurant/config/ConfigProvider.tsx",
      "components/restaurant/config/ConfigSection.tsx",
      "components/restaurant/config/InlineEditCard.tsx",
      "components/restaurant/config/ConfigIndex.tsx",
      "components/restaurant/config/goals/ObjetivosCard.tsx",
      "components/restaurant/config/goals/TurnosCard.tsx",
      "components/restaurant/config/sites/RestaurantRows.tsx",
      "components/restaurant/config/sites/ConnectionCards.tsx",
      "components/restaurant/config/team/TeamPanel.tsx",
      "components/restaurant/config/account/AccountCards.tsx",
      "components/restaurant/config/ajustes/AjustesClient.tsx",
      "components/restaurant/config/ajustes/CompanyCard.tsx",
    ])
      expect(read(f), f).not.toMatch(
        /(?:text|bg|border)-(?:red|green|orange)-|destructive|f28c28|e07b1/i
      );
  });
});
