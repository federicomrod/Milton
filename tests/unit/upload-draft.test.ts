// The cost-file upload survives leaving the page: the file and every
// choice live server-side (migration 044) and come back on open.

import { menuWorkspace } from "@/lib/i18n/es/menu-workspace";
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  catalogDecisionsFromDraft,
  emptyDraftDecisions,
  parseDraftDecisions,
} from "@/lib/restaurant/price-catalog/draft";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("saved choices", () => {
  it("keeps only well-formed choices", () => {
    const parsed = parseDraftDecisions({
      units: { a: "oz", b: "none", c: "parsec", d: 3 },
      asIngredient: { p: true, q: "yes" },
      conflicts: { x: "catalog", y: 1, z: "none", w: -1, v: "bogus" },
      reviewedUnits: true,
      extra: "ignored",
    });
    expect(parsed).toEqual({
      units: { a: "oz", b: "none" },
      asIngredient: { p: true },
      conflicts: { x: "catalog", y: 1, z: "none" },
      reviewedUnits: true,
    });
    expect(parseDraftDecisions(null)).toEqual(emptyDraftDecisions());
    expect(parseDraftDecisions([1, 2])).toEqual(emptyDraftDecisions());
  });

  it("sends the save exactly what the person answered; Ninguna stays Pendiente", () => {
    const rows = [
      { key: "amb", kind: "ingredient", status: "ambiguous_unit" },
      { key: "amb-none", kind: "ingredient", status: "ambiguous_unit" },
      { key: "chk", kind: "ingredient", status: "check_unit" },
      { key: "prep", kind: "preparation", status: "ok" },
    ];
    const draft = {
      units: { amb: "lb", "amb-none": "none", chk: "oz" },
      asIngredient: { prep: true },
      conflicts: { PIMIENTA: "none" as const },
      reviewedUnits: false,
    };
    expect(catalogDecisionsFromDraft(draft, rows)).toEqual({
      rows: { amb: { unit: "lb" }, prep: { kind: "ingredient" } },
      conflicts: { PIMIENTA: "none" },
    });
    // A suggested unit only counts once "Revisé estas unidades" is ticked.
    expect(
      catalogDecisionsFromDraft({ ...draft, reviewedUnits: true }, rows).rows
    ).toMatchObject({ chk: { unit: "oz" } });
  });

  it("both saves read the file and the choices from the draft", () => {
    const catalog = read("app/api/restaurant/recipes/price-catalog/route.ts");
    expect(catalog).toContain('form.get("draft") === "1"');
    expect(catalog).toContain(
      "catalogDecisionsFromDraft(draftDecisions, read.rows)"
    );
    expect(catalog).toContain("catalog_result: result");
    const recipes = read("app/api/restaurant/recipes/import/route.ts");
    expect(recipes).toContain('form.get("draft") === "1"');
    expect(recipes).toContain("recipes_result: result");
  });

  it("the panel restores the draft on open and saves each choice as it goes", () => {
    const panel = read(
      "components/restaurant/recipes-costing/PriceCatalogPanel.tsx"
    );
    expect(panel).toContain('fetch("/api/restaurant/recipes/upload-draft")');
    expect(panel).toContain('method: "PATCH"');
    expect(panel).toContain("await persistChoices();");
    // A choice can always be cleared back to Pendiente.
    expect(menuWorkspace.priceCatalog.noneLabel).toBe("Ninguna / Pendiente");
    expect(panel).toContain("w.noneLabel");
    // Each "parece preparación" row asks it explicitly.
    expect(menuWorkspace.priceCatalog.boughtReady).toBe(
      "¿Lo compras ya hecho?"
    );
    expect(panel).toContain("{w.boughtReady}");
    expect(panel).not.toContain("Parecen preparaciones de tu cocina");
  });
});

describe("migration 044 — upload drafts", () => {
  const sql = read("supabase/migrations/044_cost_upload_drafts.sql");
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("is additive: one new table, no drops or data changes", () => {
    expect(statements).toContain(
      "CREATE TABLE IF NOT EXISTS public.cost_upload_drafts"
    );
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(
      /ALTER TABLE public\.(?!cost_upload_drafts)/
    );
    expect(statements).not.toMatch(/\bUPDATE\s+public\./);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/);
  });

  it("is one row per company, with RLS like 038–043", () => {
    expect(statements).toContain(
      "company_id      uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE"
    );
    expect(statements).toContain("ENABLE ROW LEVEL SECURITY");
    expect(statements).toContain("is_company_member(company_id)");
    expect(statements).toContain(
      "GRANT ALL ON TABLE public.cost_upload_drafts TO anon, authenticated, service_role"
    );
  });

  it("carries the staging-only header and no production apply", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("No production apply");
  });
});
