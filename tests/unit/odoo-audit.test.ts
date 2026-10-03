import { describe, it, expect } from "vitest";
import {
  buildOdooAuditReport,
  type OdooAuditRow,
  type OdooConfigCompanyMap,
} from "@/lib/restaurant/odoo/audit";

const LOC_A = "00000000-0000-0000-0000-00000000000a";
const LOC_B = "00000000-0000-0000-0000-00000000000b";

function row(over: Partial<OdooAuditRow> & { meta?: Record<string, unknown> }) {
  const { meta, ...rest } = over;
  return {
    id: Math.random().toString(36),
    order_id: "o1",
    sale_date: "2026-02-01",
    location_id: LOC_A,
    gross_revenue: 100,
    source_metadata: meta ?? { config_id: 3 },
    ...rest,
  } as OdooAuditRow;
}

const configMap: OdooConfigCompanyMap = new Map([
  [3, { id: 1, name: "Company A" }],
  [4, { id: 2, name: "Company B" }],
]);

describe("buildOdooAuditReport", () => {
  it("groups rows across two Odoo companies with counts, sums, dates and locations", () => {
    const rows = [
      row({ order_id: "o1", sale_date: "2026-02-01", gross_revenue: 100 }),
      row({ order_id: "o1", sale_date: "2026-02-03", gross_revenue: 50.5 }),
      row({ order_id: "o2", sale_date: "2026-02-02", gross_revenue: 20 }),
      row({
        order_id: "o3",
        meta: { config_id: 4 },
        location_id: null,
        gross_revenue: "30.25",
      }),
      row({
        order_id: "o4",
        meta: { config_id: 4 },
        location_id: LOC_B,
        gross_revenue: 10,
        sale_date: "2026-01-15",
      }),
    ];
    const report = buildOdooAuditReport(rows, configMap, [1, 2]);
    expect(report.total_rows).toBe(5);
    expect(report.by_odoo_company).toEqual([
      {
        odoo_company_id: 1,
        name: "Company A",
        selected: true,
        row_count: 3,
        order_count: 2,
        gross_revenue_sum: 170.5,
        first_sale_date: "2026-02-01",
        last_sale_date: "2026-02-03",
        by_location_id: { [LOC_A]: 3 },
      },
      {
        odoo_company_id: 2,
        name: "Company B",
        selected: true,
        row_count: 2,
        order_count: 2,
        gross_revenue_sum: 40.25,
        first_sale_date: "2026-01-15",
        last_sale_date: "2026-02-01",
        by_location_id: { null: 1, [LOC_B]: 1 },
      },
    ]);
    expect(report.unverifiable.row_count).toBe(0);
  });

  it("flags selected per selectedIds", () => {
    const rows = [row({}), row({ meta: { config_id: 4 } })];
    const report = buildOdooAuditReport(rows, configMap, [2]);
    expect(report.selected_company_ids).toEqual([2]);
    expect(report.by_odoo_company.map((g) => g.selected)).toEqual([
      false,
      true,
    ]);
    expect(
      buildOdooAuditReport(rows, configMap, null).selected_company_ids
    ).toEqual([]);
  });

  it("counts a missing config_id as unverifiable", () => {
    const report = buildOdooAuditReport(
      [
        row({ meta: {} }),
        row({ meta: { config_id: null } }),
        row({ source_metadata: null }),
      ],
      configMap,
      [1]
    );
    expect(report.unverifiable).toEqual({
      row_count: 3,
      reasons: { missing_config_id: 3, config_not_found: 0 },
    });
    expect(report.by_odoo_company).toEqual([]);
  });

  it("counts a config absent from the Odoo result as unverifiable", () => {
    const report = buildOdooAuditReport(
      [row({ meta: { config_id: 99 } }), row({})],
      configMap,
      [1]
    );
    expect(report.unverifiable).toEqual({
      row_count: 1,
      reasons: { missing_config_id: 0, config_not_found: 1 },
    });
    expect(report.by_odoo_company).toHaveLength(1);
  });

  it("rows carrying odoo_company_id bypass the config lookup", () => {
    const report = buildOdooAuditReport(
      [
        row({
          meta: {
            config_id: 99,
            odoo_company_id: 5,
            odoo_company_name: "Direct",
          },
        }),
      ],
      new Map(),
      [5]
    );
    expect(report.unverifiable.row_count).toBe(0);
    expect(report.by_odoo_company[0]).toMatchObject({
      odoo_company_id: 5,
      name: "Direct",
      selected: true,
      row_count: 1,
    });
  });
});
