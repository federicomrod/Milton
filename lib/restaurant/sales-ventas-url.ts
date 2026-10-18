// lib/restaurant/sales-ventas-url.ts
//
// There is ONE Ventas page (the old Detalle). The old /sales/detalle URL
// redirects here keeping every query param; the Cockpit's old `?period=` preset
// (last_7 | month) becomes the page's `p` (7d | 30d).

import { SALES_HREF } from "@/lib/restaurant/navigation";

type Params = Record<string, string | string[] | undefined>;

/** The Cockpit's old preset → the page's period. */
export function legacyPeriodToP(
  period: string | undefined | null
): string | null {
  if (period === "month") return "30d";
  if (period === "last_7") return "7d";
  return null;
}

/** One value per key, with the old `?period=` mapped when `p` is absent. */
export function flattenVentasParams(
  params: Params
): Record<string, string | undefined> {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params))
    flat[k] = Array.isArray(v) ? v[0] : v;
  if (!flat.p) {
    const mapped = legacyPeriodToP(flat.period);
    if (mapped) flat.p = mapped;
  }
  return flat;
}

/** /sales/detalle?… → /sales?… (every param kept; `period` becomes `p`). */
export function ventasRedirectHref(params: Params): string {
  const out = new URLSearchParams();
  const mapped = !params.p ? legacyPeriodToP(firstOf(params.period)) : null;
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (k === "period" && mapped) continue;
    for (const item of Array.isArray(v) ? v : [v]) out.append(k, item);
  }
  if (mapped) out.set("p", mapped);
  const qs = out.toString();
  return qs ? `${SALES_HREF}?${qs}` : SALES_HREF;
}

function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
