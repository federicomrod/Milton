// scripts/check-no-recipe.ts
//
// READ-ONLY check (no writes of any kind): which dishes would the Plato screen
// call «sin receta» while the database DOES hold recipe data for them.
//
//   npx tsx scripts/check-no-recipe.ts <company_id>
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the process
// environment (never printed). Prints counts and dish names only.
//
// Logic
//   1. Load the company's POS links, recipe versions and version inputs.
//   2. A link is "recipe-less on screen" when the shared helper
//      (lib/restaurant/costing/dish-version.ts) finds no usable version from
//      the link's own menu_item_id: no id, no version, or a version with no
//      inputs and no evidence lines.
//   3. Of those, report the ones that DO have data, by cause:
//        - in_review_only:        versions exist, none approved (not Excel);
//        - legacy_only:           every version came from an Excel import;
//        - evidence_only:         no version, but the link evidence has lines;
//        - version_without_lines: a version with no inputs and no evidence.
//      A menu_item_id carried only by the link (not by the list row) is
//      resolved by the helper, so such dishes are no longer reported.
//   Nothing is written; run it against staging or a copy, never edit data here.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  dishHasRecipe,
  pickDishVersion,
} from "../lib/restaurant/costing/dish-version";

interface LinkRow {
  odoo_product_id: number;
  odoo_name: string | null;
  menu_item_id: string | null;
  evidence: Record<string, unknown> | null;
}
interface VersionRow {
  id: string;
  menu_item_id: string;
  version_number: number;
  status: string;
  effective_date: string | null;
  source_type: string | null;
}

async function main() {
  const companyId = process.argv[2];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!companyId || !url || !key) {
    console.error(
      "Usage: npx tsx scripts/check-no-recipe.ts <company_id>  (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment)"
    );
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const links = await readAll<LinkRow>(
    "pos_product_links",
    companyId,
    supabase,
    "odoo_product_id, odoo_name, menu_item_id, evidence"
  );
  const versions = await readAll<VersionRow>(
    "recipe_versions",
    companyId,
    supabase,
    "id, menu_item_id, version_number, status, effective_date, source_type"
  );
  const inputs = await readAll<{ recipe_version_id: string }>(
    "recipe_version_inputs",
    companyId,
    supabase,
    "recipe_version_id"
  );

  const byMenu = new Map<string, VersionRow[]>();
  for (const v of versions) {
    byMenu.set(v.menu_item_id, [...(byMenu.get(v.menu_item_id) ?? []), v]);
  }
  const inputCount = new Map<string, number>();
  for (const i of inputs) {
    inputCount.set(
      i.recipe_version_id,
      (inputCount.get(i.recipe_version_id) ?? 0) + 1
    );
  }

  const buckets: Record<string, string[]> = {
    in_review_only: [],
    legacy_only: [],
    evidence_only: [],
    version_without_lines: [],
  };
  let screenEmpty = 0;
  for (const link of links) {
    const pick = pickDishVersion({
      productMenuItemId: null, // the list row's own id may be missing...
      linkMenuItemId: link.menu_item_id, // ...the link's is what the helper falls back to
      versionsByMenuItem: byMenu,
    });
    const evidenceLines = Array.isArray(link.evidence?.lines)
      ? (link.evidence?.lines as unknown[]).length
      : 0;
    const lines = pick.version ? (inputCount.get(pick.version.id) ?? 0) : 0;
    const shown = dishHasRecipe({
      menuItemId: pick.menu_item_id,
      versionId: pick.version?.id,
      lineCount: lines,
      evidenceLineCount: evidenceLines,
    });
    if (shown) continue;
    screenEmpty += 1;
    const name = link.odoo_name ?? `#${link.odoo_product_id}`;
    if (pick.version && lines === 0 && evidenceLines === 0) {
      buckets.version_without_lines.push(name);
    } else if (!pick.version && evidenceLines > 0) {
      buckets.evidence_only.push(name);
    } else if (pick.versions.length > 0 && !pick.approved) {
      (pick.versions.every((v) => v.source_type === "import")
        ? buckets.legacy_only
        : buckets.in_review_only
      ).push(name);
    }
  }

  console.log(`links: ${links.length}, empty on screen: ${screenEmpty}`);
  for (const [cause, names] of Object.entries(buckets)) {
    console.log(`\n${cause}: ${names.length}`);
    for (const n of names.sort()) console.log(`  - ${n}`);
  }
}

async function readAll<T>(
  table: string,
  companyId: string,
  supabase: SupabaseClient,
  columns: string
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("company_id", companyId)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
