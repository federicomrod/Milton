import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/038_pos_product_links.sql"),
  "utf8"
);
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 038 — POS product links", () => {
  it("adds the links table, nullable odoo_product_id, and combo columns", () => {
    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS public.pos_product_links"
    );
    expect(sql).toContain("odoo_product_id");
    expect(sql).toContain("por_clasificar");
    expect(sql).toContain("requiere_receta");
    expect(sql).toContain("componente");
    expect(sql).toContain("no_requiere_costeo");
    expect(sql).toContain("sin_vincular");
    expect(sql).toContain("sugerido");
    expect(sql).toContain("confirmado");
    expect(sql).toContain("confirmed_by");
    expect(sql).toContain("confirmed_at");
    expect(sql).toContain("confirmed_how");
    expect(sql).toContain("evidence jsonb");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS odoo_product_id integer NULL"
    );
    expect(sql).toContain("combo_parent_external_line_id");
    expect(sql).toContain("combo_parent_odoo_product_id");
    expect(statements).not.toMatch(/\bDROP TABLE\b/i);
    expect(statements).not.toMatch(/\bDROP COLUMN\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/);
  });

  it("requires a person before Confirmado and matches per-company RLS", () => {
    expect(sql).toContain("link_state = 'confirmado'");
    expect(sql).toContain("confirmed_by IS NOT NULL");
    expect(sql).toContain("confirmed_how IS NOT NULL");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("is_company_member(company_id)");
    expect(sql).toContain("pos_product_links_member");
    expect(sql).toContain(
      "GRANT ALL ON TABLE public.pos_product_links TO anon, authenticated, service_role"
    );
    expect(sql).toContain("pos_product_links_location_uniq");
    expect(sql).toContain("pos_product_links_company_wide_uniq");
  });

  it("contains the manual-apply note for staging after 037", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("r1-staging");
    expect(sql).toContain("after 037");
  });
});
