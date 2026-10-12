import { describe, it, expect } from "vitest";
import {
  dropColumnFromSelect,
  errorMentionsColumn,
  omitColumnFromRows,
  upsertRetryingWithoutColumn,
  upsertRetryingWithoutColumns,
} from "@/lib/restaurant/missing-schema-column";

describe("errorMentionsColumn", () => {
  it("matches Postgres and PostgREST missing-column wording", () => {
    expect(
      errorMentionsColumn(
        { message: "column pos_sales_items.is_tip does not exist" },
        "is_tip"
      )
    ).toBe(true);
    expect(
      errorMentionsColumn(
        {
          message:
            "Could not find the 'is_tip' column of 'pos_sales_items' in the schema cache",
        },
        "is_tip"
      )
    ).toBe(true);
    expect(
      errorMentionsColumn({ message: "permission denied" }, "is_tip")
    ).toBe(false);
    expect(errorMentionsColumn(null, "is_tip")).toBe(false);
  });
});

describe("dropColumnFromSelect / omitColumnFromRows", () => {
  it("removes only the named column", () => {
    expect(
      dropColumnFromSelect("id, sale_date, is_tip, quantity", "is_tip")
    ).toBe("id, sale_date, quantity");
    expect(
      omitColumnFromRows([{ id: 1, is_tip: true, name: "Propina" }], "is_tip")
    ).toEqual([{ id: 1, name: "Propina" }]);
  });
});

describe("upsertRetryingWithoutColumn", () => {
  it("retries without the column when the first upsert names it", async () => {
    const calls: Array<Record<string, unknown>[]> = [];
    const result = await upsertRetryingWithoutColumn(
      "is_tip",
      async (rows) => {
        calls.push(rows);
        if (rows.some((r) => "is_tip" in r)) {
          return {
            error: {
              message:
                'column "is_tip" of relation "pos_sales_items" does not exist',
            },
            count: null,
          };
        }
        return { error: null, count: rows.length };
      },
      [{ id: "1", is_tip: true, raw_item_name: "Propina" }]
    );
    expect(result.error).toBeNull();
    expect(result.count).toBe(1);
    expect(result.omittedColumn).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toHaveProperty("is_tip");
    expect(calls[1][0]).not.toHaveProperty("is_tip");
  });

  it("does not retry when the error is unrelated", async () => {
    let calls = 0;
    const result = await upsertRetryingWithoutColumn(
      "is_tip",
      async (rows) => {
        calls += 1;
        return { error: { message: "unique constraint" }, count: null };
      },
      [{ id: "1", is_tip: false }]
    );
    expect(result.error?.message).toBe("unique constraint");
    expect(result.omittedColumn).toBe(false);
    expect(calls).toBe(1);
  });
});

describe("upsertRetryingWithoutColumns", () => {
  it("strips each missing optional column until the upsert succeeds", async () => {
    const calls: Array<string[]> = [];
    const result = await upsertRetryingWithoutColumns(
      [
        "is_tip",
        "combo_parent_external_line_id",
        "combo_parent_odoo_product_id",
      ],
      async (rows) => {
        const keys = Object.keys(rows[0] ?? {});
        calls.push(keys);
        if (keys.includes("is_tip")) {
          return { error: { message: 'column "is_tip" does not exist' } };
        }
        if (keys.includes("combo_parent_external_line_id")) {
          return {
            error: {
              message: 'column "combo_parent_external_line_id" does not exist',
            },
          };
        }
        return { error: null, count: 1 };
      },
      [
        {
          id: "1",
          is_tip: false,
          combo_parent_external_line_id: "9",
          combo_parent_odoo_product_id: 3,
        },
      ]
    );
    expect(result.error).toBeNull();
    expect(result.omittedColumns).toEqual([
      "is_tip",
      "combo_parent_external_line_id",
    ]);
    expect(calls.at(-1) ?? []).not.toContain("is_tip");
    expect(calls.at(-1) ?? []).not.toContain("combo_parent_external_line_id");
    expect(calls.at(-1) ?? []).toContain("combo_parent_odoo_product_id");
  });
});
