// lib/restaurant/odoo/audit.ts
//
// Pure grouping logic for the read-only Odoo audit
// (GET /api/restaurant/pos/odoo-audit): how do existing pos_source='odoo'
// pos_sales_items rows break down by Odoo company? Aggregates only — no
// record payloads leave this module.

export interface OdooAuditRow {
  id: string;
  order_id: string | null;
  sale_date: string;
  location_id: string | null;
  gross_revenue: number | string | null;
  source_metadata: Record<string, unknown> | null;
}

/** pos.config id -> its Odoo company, as returned by Odoo. */
export type OdooConfigCompanyMap = Map<number, { id: number; name: string }>;

export interface OdooAuditCompanyGroup {
  odoo_company_id: number;
  name: string;
  selected: boolean;
  row_count: number;
  order_count: number;
  gross_revenue_sum: number;
  first_sale_date: string | null;
  last_sale_date: string | null;
  by_location_id: Record<string, number>;
}

export interface OdooAuditReport {
  generated_at: string;
  selected_company_ids: number[];
  by_odoo_company: OdooAuditCompanyGroup[];
  unverifiable: {
    row_count: number;
    reasons: { missing_config_id: number; config_not_found: number };
  };
  total_rows: number;
}

function asInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

export function buildOdooAuditReport(
  rows: OdooAuditRow[],
  configCompanyMap: OdooConfigCompanyMap,
  selectedIds: number[] | null | undefined,
  now: Date = new Date()
): OdooAuditReport {
  const selected = new Set(selectedIds ?? []);
  const groups = new Map<
    number,
    OdooAuditCompanyGroup & { _orders: Set<string> }
  >();
  const reasons = { missing_config_id: 0, config_not_found: 0 };

  for (const row of rows) {
    const meta = row.source_metadata ?? {};
    // Rows written after this change record their Odoo company directly.
    let companyId = asInt(meta.odoo_company_id);
    let name =
      typeof meta.odoo_company_name === "string" ? meta.odoo_company_name : "";
    if (companyId === null) {
      const configId = asInt(meta.config_id);
      if (configId === null) {
        reasons.missing_config_id++;
        continue;
      }
      const company = configCompanyMap.get(configId);
      if (!company) {
        reasons.config_not_found++;
        continue;
      }
      companyId = company.id;
      name = company.name;
    }

    let g = groups.get(companyId);
    if (!g) {
      g = {
        odoo_company_id: companyId,
        name,
        selected: selected.has(companyId),
        row_count: 0,
        order_count: 0,
        gross_revenue_sum: 0,
        first_sale_date: null,
        last_sale_date: null,
        by_location_id: {},
        _orders: new Set<string>(),
      };
      groups.set(companyId, g);
    }
    if (!g.name && name) g.name = name;
    g.row_count++;
    if (row.order_id) g._orders.add(row.order_id);
    g.gross_revenue_sum += Number(row.gross_revenue ?? 0) || 0;
    if (!g.first_sale_date || row.sale_date < g.first_sale_date) {
      g.first_sale_date = row.sale_date;
    }
    if (!g.last_sale_date || row.sale_date > g.last_sale_date) {
      g.last_sale_date = row.sale_date;
    }
    const locKey = row.location_id ?? "null";
    g.by_location_id[locKey] = (g.by_location_id[locKey] ?? 0) + 1;
  }

  const by_odoo_company = Array.from(groups.values())
    .sort((a, b) => a.odoo_company_id - b.odoo_company_id)
    .map(({ _orders, ...g }) => ({
      ...g,
      order_count: _orders.size,
      gross_revenue_sum: Math.round(g.gross_revenue_sum * 100) / 100,
    }));

  return {
    generated_at: now.toISOString(),
    selected_company_ids: Array.from(selected),
    by_odoo_company,
    unverifiable: {
      row_count: reasons.missing_config_id + reasons.config_not_found,
      reasons,
    },
    total_rows: rows.length,
  };
}
