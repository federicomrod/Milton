import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("recipe costing routes", () => {
  it("keeps company on the server and coverage out of React", () => {
    const costing = read("app/api/restaurant/recipes/costing/route.ts");
    expect(costing).toContain("authAndCompany");
    expect(costing).toContain("loadRecipeCostingWorkspace");
    expect(costing).not.toMatch(/searchParams\.get\(["']company_id["']\)/);

    const confirm = read("app/api/restaurant/pos/links/confirm/route.ts");
    expect(confirm).toContain("confirmPosLinkForCompany");
    expect(confirm).toContain("authAndCompany");

    const ui = read("components/restaurant/recipes-costing/ResumenScreen.tsx");
    expect(ui).toContain("coverage.coverage_label");
    expect(ui).not.toMatch(/coverage_pct\s*[+\-*/]/);
    expect(ui).not.toMatch(/net_sales\s*[+\-*/]/);
  });

  it("does not add vercel, CI or secret files", () => {
    const files = [
      "app/api/restaurant/pos/links/confirm/route.ts",
      "app/api/restaurant/recipes/approve/route.ts",
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      expect(src).not.toMatch(/VERCEL_|SUPABASE_SERVICE_ROLE|vercel\.json/);
    }
  });
});
