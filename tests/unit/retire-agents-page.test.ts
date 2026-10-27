// #379: the English «Centro de agentes» page is retired. Nothing in prod
// still proposes an action that needs approving there (Ask Milton drops
// every per-item chip), so the page, its routes and the footer line go.

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((href: string) => {
  throw new Error(`REDIRECT:${href}`);
});
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { COCKPIT_HREF, LEGACY_ROUTE_MAP } from "@/lib/restaurant/navigation";
import {
  SETUP_STEP_HREFS,
  setupProgress,
} from "@/lib/restaurant/setup-progress";
import type {
  DataQualityCounts,
  SetupCounts,
} from "@/lib/restaurant/profitability-server";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("Centro de agentes is retired (#379)", () => {
  it("the page, its component and its API routes are gone", () => {
    for (const gone of [
      "components/restaurant/AgentControlCenter.tsx",
      "app/api/restaurant/agents",
      "app/api/restaurant/agent-actions",
      "app/api/restaurant/ask-milton/create-action",
      "lib/restaurant/agents",
    ]) {
      expect(existsSync(join(root, gone)), gone).toBe(false);
    }
  });

  it("no app code calls a removed route or links to the old page", () => {
    const files = [
      ...sourceFiles("app"),
      ...sourceFiles("components"),
      ...sourceFiles("lib"),
    ].filter((f) => !f.endsWith(join("restaurant", "agents", "page.tsx")));
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/\/api\/restaurant\/agents\//);
      expect(src, f).not.toMatch(/\/api\/restaurant\/agent-actions/);
      expect(src, f).not.toMatch(/ask-milton\/create-action/);
      if (!f.endsWith("navigation.ts")) {
        expect(src, f).not.toContain("/dashboard/restaurant/agents");
      }
    }
  });

  it("the old URL redirects to Resumen and keeps its params", async () => {
    const { default: AgentsRedirect } = await import(
      "@/app/dashboard/restaurant/agents/page"
    );
    await expect(
      AgentsRedirect({ searchParams: Promise.resolve({ location: "loc-1" }) })
    ).rejects.toThrow(`REDIRECT:${COCKPIT_HREF}?location=loc-1`);
    const route = LEGACY_ROUTE_MAP.find((r) => r.id === "agents");
    expect(route?.resolvesTo).toBe(COCKPIT_HREF);
  });

  it("Ask Milton no longer says you approve actions in Agentes", () => {
    const src = read("components/restaurant/AskMiltonWorkspace.tsx");
    expect(src).not.toMatch(/apruebas en Agentes|approve them in Agents/);
    expect(src).not.toContain("create-action");
  });

  it("the briefing no longer sends people to the agent control center", () => {
    const src = read("lib/restaurant/briefing-prompt.ts");
    expect(src).not.toMatch(/Centro de Control de Agentes|Agent Control Center/);
  });

  it("setup progress has no agents step", () => {
    expect(Object.keys(SETUP_STEP_HREFS)).not.toContain("agents");
    const counts: SetupCounts = {
      pos_sales_count: 1,
      cost_entries_count: 1,
      menu_items_count: 1,
      mappings_count: 1,
      recipe_inputs_count: 1,
      supplier_invoices_count: 1,
      ingredients_count: 1,
    };
    const dq = {
      unmapped_pos_items: 0,
      menu_items_without_recipe: 0,
    } as unknown as DataQualityCounts;
    const p = setupProgress(counts, dq);
    expect(p.total).toBe(5);
    expect(p.complete).toBe(true);
    expect(p.nextHref).toBeNull();
  });
});
