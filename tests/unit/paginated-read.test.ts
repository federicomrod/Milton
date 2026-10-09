import { describe, it, expect } from "vitest";
import {
  fetchAllRows,
  POSTGREST_MAX_ROWS,
  PAGINATED_READ_SAFETY_CAP,
} from "@/lib/restaurant/paginated-read";
import { createCappedSupabase } from "./helpers/capped-supabase";

function rows(n: number, prefix = "row") {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(5, "0")}`,
    n: i,
  }));
}

describe("fetchAllRows", () => {
  it("walks past a 1,000-row PostgREST cap to return every row", async () => {
    const all = rows(2_500);
    const supabase = createCappedSupabase({
      tables: { items: all },
      maxRowsPerRequest: POSTGREST_MAX_ROWS,
    });
    let pages = 0;
    const result = await fetchAllRows<{ id: string; n: number }>(() => {
      pages += 1;
      return supabase.from("items").select("id, n");
    });
    expect(result.error).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(2_500);
    expect(result.rows[0].id).toBe("row-00000");
    expect(result.rows[2_499].id).toBe("row-02499");
    expect(pages).toBe(3);
  });

  it("a single unbounded / high-limit request on the same mock is truncated", async () => {
    const supabase = createCappedSupabase({
      tables: { items: rows(2_500) },
      maxRowsPerRequest: POSTGREST_MAX_ROWS,
    });
    const { data } = await supabase.from("items").select("id").limit(10_000);
    expect(data).toHaveLength(POSTGREST_MAX_ROWS);
  });

  it("sets truncated when the safety cap is hit", async () => {
    const supabase = createCappedSupabase({
      tables: { items: rows(20) },
      maxRowsPerRequest: POSTGREST_MAX_ROWS,
    });
    const result = await fetchAllRows(
      () => supabase.from("items").select("id"),
      {
        safetyCap: 5,
      }
    );
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(5);
  });

  it("exports a safety cap far above a busy restaurant's pilot year", () => {
    // ~10k POS lines/month × 12 ≈ 120k; 500k leaves headroom.
    expect(PAGINATED_READ_SAFETY_CAP).toBeGreaterThanOrEqual(500_000);
  });
});
