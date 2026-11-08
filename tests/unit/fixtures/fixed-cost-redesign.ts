// Synthetic fixtures for the fixed-cost redesign. Not hosted data, not a
// statement about any real month: October 32 920 local, 21 000 shared, tax 13 %.
import { computeFixedFigures } from "@/lib/restaurant/fixed-cost-engine";
import {
  effectiveFixedCosts,
  type AmountCategory,
  type FixedCostLine,
} from "@/lib/restaurant/fixed-costs";
import type { ItemView } from "@/lib/restaurant/fixed-costs-server";
import type { MonthInput } from "@/lib/restaurant/fixed-cost-overview";

export const SEP = "2026-09-01";
export const OCT = "2026-10-01";
export const NOV = "2026-11-01";

export const line = (
  month: string,
  category: FixedCostLine["category"],
  amount: number | null,
  extra: Partial<FixedCostLine> = {}
): FixedCostLine => ({
  id: `${month}-${category}`,
  location_id: "loc-1",
  month,
  category,
  label: null,
  amount: category === "impuestos" ? null : amount,
  pct_of_sales: category === "impuestos" ? amount : null,
  currency: "USD",
  source: "upload",
  status: "confirmed",
  repeats: false,
  split_rule: null,
  detail_state: "legacy_total",
  ...extra,
});

export const item = (
  id: string,
  label: string | null,
  amount: number,
  kind: ItemView["kind"] = "item",
  origin: ItemView["origin"] = { fileName: "octubre.xlsx" }
): ItemView => ({
  id,
  label,
  cents: Math.round(amount * 100),
  kind,
  version: 1,
  origin,
});

export const SERVICES = [
  item("s1", "Electricidad", 1800),
  item("s2", "Agua", 650),
  item("s3", "Internet", 1450),
  item("s4", "Seguro", 100),
  item("s5", "Gas", 900),
];

export function monthInput(
  month: string,
  lines: FixedCostLine[],
  opts: {
    items?: MonthInput["items"];
    shared?: Partial<Record<AmountCategory, number>>;
    groupTax?: number | null;
    margin?: boolean;
  } = {}
): MonthInput {
  const shared = opts.shared ?? {};
  const confirmed = lines.filter((l) => l.status === "confirmed");
  const costs = effectiveFixedCosts(confirmed, shared, opts.groupTax ?? null);
  const localTax = confirmed.some(
    (l) => l.category === "impuestos" && l.pct_of_sales !== null
  );
  const figures = computeFixedFigures({
    month,
    costs,
    taxSource: localTax ? "local" : opts.groupTax != null ? "group" : null,
    margin:
      opts.margin === false
        ? null
        : { sales: 200000, foodCost: 40000, unplannedWaste: 2000 },
    openDays: 26,
  });
  return {
    month,
    lines,
    items: opts.items ?? {},
    groupShares: shared,
    groupImpuestosPct: opts.groupTax ?? null,
    figures,
  };
}

/** October complete locally; shared 21 000; November partial 25 800; September empty. */
export function acceptance() {
  const oct = monthInput(
    OCT,
    [
      line(OCT, "planilla", 21400),
      line(OCT, "alquiler", 6500),
      line(OCT, "servicios", 4900, { detail_state: "itemized" }),
      line(OCT, "otros", 120),
      line(OCT, "impuestos", 13),
    ],
    {
      items: { servicios: SERVICES },
      shared: { planilla: 21000 },
    }
  );
  const nov = monthInput(NOV, [
    line(NOV, "planilla", 20000),
    line(NOV, "alquiler", 5800),
  ]);
  const sep = monthInput(SEP, []);
  return { sep, oct, nov };
}
