// Configuración: each tab shows ONLY its own section; the tab is in the URL
// (?tab=); old links keep working. Synthetic data only.
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
let admin = false;
vi.mock("@/lib/restaurant/shell-context-server", () => ({
  loadRestaurantShellChrome: async () => ({ lang: "es", isAdmin: admin }),
}));
vi.mock("@/components/restaurant/shell/OperatingPageHeader", () => ({
  OperatingPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/restaurant/settings/PosSalesUploadPanel", () => ({
  PosSalesUploadPanel: () => <div data-testid="pos-upload">SUBIDA VENTAS</div>,
}));
vi.mock("@/components/restaurant/settings/tabs/RestaurantTab", () => ({
  RestaurantTab: () => <div data-testid="tab-restaurante">RENOMBRAR</div>,
}));
vi.mock("@/components/restaurant/settings/tabs/ObjetivosTab", () => ({
  ObjetivosTab: () => <div data-testid="tab-objetivos">OBJETIVOS</div>,
}));
vi.mock("@/components/restaurant/settings/tabs/TurnosTab", () => ({
  TurnosTab: () => <div data-testid="tab-turnos">TURNOS</div>,
}));

import ConfiguracionPage from "@/app/dashboard/restaurant/data/page";
import { configTabHref, parseConfigTab } from "@/lib/restaurant/config-tabs";
import { ConfigTabs } from "@/components/restaurant/settings/ConfigTabs";
import RestaurantRedirect from "@/app/dashboard/restaurant/data/restaurante/page";
import ObjetivosRedirect from "@/app/dashboard/restaurant/data/objetivos/page";
import TurnosRedirect from "@/app/dashboard/restaurant/data/turnos/page";

async function html(params: Record<string, string> = {}) {
  const el = await ConfiguracionPage({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  admin = false;
  redirect.mockClear();
});

describe("which tab a URL asks for", () => {
  it("?tab= wins, the older ?seccion= still works, the default is Conexiones", () => {
    expect(parseConfigTab({ tab: "cuenta" }, false)).toBe("cuenta");
    expect(parseConfigTab({ seccion: "turnos" }, false)).toBe("turnos");
    expect(parseConfigTab({ tab: "objetivos", seccion: "turnos" }, false)).toBe(
      "objetivos"
    );
    expect(parseConfigTab({}, false)).toBe("conexiones");
    expect(parseConfigTab({ tab: "nada" }, false)).toBe("conexiones");
  });
  it("Equipo is for admins only", () => {
    expect(parseConfigTab({ tab: "equipo" }, false)).toBe("conexiones");
    expect(parseConfigTab({ tab: "equipo" }, true)).toBe("equipo");
  });
  it("builds the URL of a tab and keeps extra params", () => {
    expect(configTabHref("turnos")).toBe(
      "/dashboard/restaurant/data?tab=turnos"
    );
    expect(configTabHref("objetivos", { aplica: "r1" })).toBe(
      "/dashboard/restaurant/data?tab=objetivos&aplica=r1"
    );
  });
});

describe("the tab bar", () => {
  it("one link per tab to ?tab=, the active one marked; no Equipo for non-admins", () => {
    const out = renderToStaticMarkup(
      <ConfigTabs active="turnos" lang="es" isAdmin={false} />
    );
    for (const tab of [
      "restaurante",
      "conexiones",
      "objetivos",
      "turnos",
      "cuenta",
    ])
      expect(out).toContain(`href="/dashboard/restaurant/data?tab=${tab}"`);
    expect(out).not.toContain("tab=equipo");
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page"[^>]*>Turnos</);
    expect(
      renderToStaticMarkup(<ConfigTabs active="equipo" lang="es" isAdmin />)
    ).toContain("tab=equipo");
  });
});

describe("each tab shows only its section", () => {
  it("Conexiones: connect your POS + upload sales; nothing of the other tabs", async () => {
    const out = await html({ tab: "conexiones" });
    expect(out).toContain("Conectar tu punto de venta");
    expect(out).toContain("Subir ventas (archivo)");
    expect(out).toContain('data-testid="pos-upload"');
    for (const other of ["RENOMBRAR", "OBJETIVOS", "TURNOS", "Invitaciones"])
      expect(out).not.toContain(other);
    expect(out).not.toContain("Cuenta:");
  });
  it("Restaurante, Objetivos and Turnos each render only their own content", async () => {
    const restaurante = await html({ tab: "restaurante" });
    expect(restaurante).toContain("RENOMBRAR");
    expect(restaurante).not.toMatch(/OBJETIVOS<|TURNOS<|Conectar tu punto/);
    const objetivos = await html({ tab: "objetivos" });
    expect(objetivos).toContain("OBJETIVOS");
    expect(objetivos).not.toMatch(/RENOMBRAR|TURNOS<|Conectar tu punto/);
    const turnos = await html({ tab: "turnos" });
    expect(turnos).toContain("TURNOS");
    expect(turnos).not.toMatch(/RENOMBRAR|OBJETIVOS<|Conectar tu punto/);
  });
  it("Cuenta: account and settings, one row each, no duplicates", async () => {
    const out = await html({ tab: "cuenta" });
    expect(out.match(/href="\/dashboard\/account"/g)).toHaveLength(1);
    expect(out.match(/href="\/dashboard\/settings"/g)).toHaveLength(1);
    expect(out).toContain("Cuenta: perfil, empresa y avisos");
    expect(out).toContain("Ajustes: zona horaria, moneda y formato");
    expect(out).not.toContain("Conectar tu punto");
  });
  it("Equipo (admin): invitations only", async () => {
    admin = true;
    const out = await html({ tab: "equipo" });
    expect(out).toContain("Invitaciones");
    expect(out).toContain('href="/management/invites"');
    expect(out).not.toContain("Conectar tu punto");
  });
  it("a heading appears once: the title, and one line under it that changes per tab", async () => {
    const a = await html({ tab: "conexiones" });
    const b = await html({ tab: "cuenta" });
    expect(a.match(/<h1>/g)).toHaveLength(1);
    expect(a.match(/<h2/g)).toBeNull();
    expect(a).toContain("De dónde vienen tus ventas");
    expect(b).toContain("Tu perfil, tu empresa y tus preferencias");
  });
  it("the older ?seccion=conexiones still opens Conexiones with the upload open", async () => {
    const out = await html({ seccion: "conexiones" });
    expect(out).toContain("Subir ventas (archivo)");
    expect(out).toContain("<details open");
  });
});

describe("old routes redirect to their tab, keeping the other params", () => {
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
});

describe("source rules", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("«Aplica a» keeps the Objetivos tab in the URL", () => {
    expect(read("components/restaurant/settings/AppliesTo.tsx")).toContain(
      "?tab=objetivos&aplica="
    );
  });
  it("no orange in the Configuración files", () => {
    for (const f of [
      "app/dashboard/restaurant/data/page.tsx",
      "components/restaurant/settings/ConfigTabs.tsx",
      "components/restaurant/settings/tabs/RestaurantTab.tsx",
      "components/restaurant/settings/tabs/ObjetivosTab.tsx",
      "components/restaurant/settings/tabs/TurnosTab.tsx",
    ])
      expect(read(f), f).not.toMatch(/f28c28|e07b1|orange-/i);
  });
});
