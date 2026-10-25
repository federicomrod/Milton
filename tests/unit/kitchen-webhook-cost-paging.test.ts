// The Telegram webhook reads every ingredient and every cost entry in pages:
// a plain select stops at 1,000 rows and would silently leave ingredients
// without a price.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { makeFakeDb } from "./helpers/fake-db";

describe("paged reads", () => {
  it("2,500 cost entries all come back (not the first 1,000)", async () => {
    const store = {
      ingredient_cost_entries: Array.from({ length: 2500 }, (_, i) => ({
        id: `c-${String(i).padStart(5, "0")}`,
        company_id: "co-1",
        ingredient_id: `i-${i % 50}`,
      })),
    };
    const db = makeFakeDb(store);
    const res = await fetchAllRows<{ id: string }>(() =>
      (
        db.from("ingredient_cost_entries") as unknown as {
          select: (c: string) => { eq: (c: string, v: string) => never };
        }
      )
        .select("id")
        .eq("company_id", "co-1")
    );
    expect(res.error).toBeNull();
    expect(res.rows).toHaveLength(2500);
  });

  it("the webhook and the confirm route use it", () => {
    const webhook = readFileSync(
      join(process.cwd(), "app/api/telegram/webhook/route.ts"),
      "utf8"
    );
    // The webhook reads the catalog through the shared helper, which pages.
    expect(webhook).toMatch(/loadDraftMatchingCatalog/);
    expect(webhook).not.toMatch(/\.in\("ingredient_id", ingredientIds\)/);
    const catalog = readFileSync(
      join(process.cwd(), "lib/restaurant/kitchen-draft-catalog.ts"),
      "utf8"
    );
    expect(catalog).toMatch(/fetchAllRows<IngredientCostEntry>/);
    expect(catalog).not.toMatch(/\.in\("ingredient_id", ingredientIds\)/);
    const confirm = readFileSync(
      join(
        process.cwd(),
        "app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route.ts"
      ),
      "utf8"
    );
    expect(confirm).toContain("fetchAllRows<IngredientCostEntry>");
  });
});
