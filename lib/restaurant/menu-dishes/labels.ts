// lib/restaurant/menu-dishes/labels.ts
//
// The words of the Platos numbers in the person's language: margin and
// cost % with their coverage, the group status chip and its tooltip. Same
// rules as costing/rollup.ts (marginLabel, costPctLabel, groupStatusDisplay);
// only the language changes. A missing price is never 0.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  groupStatusDisplay,
  type RollupTotals,
} from "@/lib/restaurant/costing/rollup";
import type { DishStatus } from "@/lib/restaurant/costing/dish-status";
import { dishStatusLabel } from "./status-labels";

function pctWithCoverage(
  value: number | null,
  coverage: number,
  lang: PreferredLanguage
): string {
  const d = getDictionary(lang).menu.screens;
  if (value === null) return d.noPrice;
  const pct = `${Math.round(value)}%`;
  return coverage < 0.9995
    ? fmt(d.dishes.marginCoverage, {
        pct,
        coverage: Math.round(coverage * 100),
      })
    : pct;
}

export function marginText(
  r: Pick<RollupTotals, "margin_pct" | "coverage">,
  lang: PreferredLanguage = "es"
): string {
  return pctWithCoverage(r.margin_pct, r.coverage, lang);
}

export function costPctText(
  r: Pick<RollupTotals, "food_cost_pct" | "coverage">,
  lang: PreferredLanguage = "es"
): string {
  return pctWithCoverage(r.food_cost_pct, r.coverage, lang);
}

export function coverageTip(lang: PreferredLanguage = "es"): string {
  return getDictionary(lang).menu.screens.dishes.coverageTip;
}

/** The status chip of a dish or group, in `lang` (see groupStatusDisplay). */
export function groupStatusText(
  node: {
    cost_status: DishStatus;
    approved_count?: number;
    variant_count?: number;
  },
  lang: PreferredLanguage = "es"
): { status: DishStatus; label: string; mixed: boolean } {
  const base = groupStatusDisplay(node);
  const label = base.mixed
    ? fmt(getDictionary(lang).menu.screens.dishes.approvedOf, {
        approved: node.approved_count ?? 0,
        total: node.variant_count ?? 0,
      })
    : dishStatusLabel(base.status, lang);
  return { ...base, label };
}
