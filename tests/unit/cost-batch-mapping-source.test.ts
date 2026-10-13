// Every cost upload writes one cost_import_batches row. Its mapping_source
// must be a value the database CHECK allows (migration 028), or the whole
// upload fails on its first write ("cost_import_batches_mapping_source_check").

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { WORKBOOK_MAPPING_SOURCES } from "@/lib/restaurant/cost-workbook/types";

function allowedByMigration028(): string[] {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/028_cost_workbook_import.sql"),
    "utf8"
  );
  const check = sql.match(
    /mapping_source[^;]*?CHECK \(mapping_source IN \(([^)]*)\)\)/
  );
  if (!check) throw new Error("mapping_source CHECK not found in 028");
  return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("cost_import_batches.mapping_source", () => {
  it("the app's values are exactly what migration 028 allows", () => {
    expect([...WORKBOOK_MAPPING_SOURCES].sort()).toEqual(
      allowedByMigration028()
    );
  });

  it("every batch the code creates uses an allowed value", () => {
    const allowed = new Set(allowedByMigration028());
    const used: Array<{ file: string; value: string }> = [];
    for (const file of [...sourceFiles("lib"), ...sourceFiles("app")]) {
      const text = readFileSync(join(process.cwd(), file), "utf8");
      for (const m of text.matchAll(/mappingSource:\s*"([^"]+)"/g)) {
        used.push({ file, value: m[1] });
      }
    }
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((row) => !allowed.has(row.value))).toEqual([]);
    // The price list and the recipe import (both plain code) send "mixed".
    expect(used).toEqual(
      expect.arrayContaining([
        { file: "lib/restaurant/price-catalog/apply.ts", value: "mixed" },
        { file: "lib/restaurant/recipe-import/server.ts", value: "mixed" },
      ])
    );
  });
});
