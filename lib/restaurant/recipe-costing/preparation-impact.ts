// What approving a preparation unlocks: how many dishes use it (directly
// or inside another preparation) and what share of food net sales they
// carry.
// Pure; used to order the Preparaciones list by impact (premise 10).

import { fmt, getDictionary } from "@/lib/i18n";
import { localeFor, type PreferredLanguage } from "@/lib/restaurant/language";

export interface ImpactDish {
  odoo_product_id: number;
  net_sales: number;
  /** Preparations the dish's current recipe uses directly. */
  component_ids: readonly string[];
}

export interface PreparationImpact {
  dishes: number;
  net_sales: number;
  share_pct: number;
}

export function preparationImpact(input: {
  dishes: readonly ImpactDish[];
  /** Preparation -> preparations its current recipe uses. */
  children: ReadonlyMap<string, readonly string[]>;
  totalNetSales: number;
}): Map<string, PreparationImpact> {
  const closure = (start: readonly string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = [...start];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const child of input.children.get(id) ?? []) stack.push(child);
    }
    return seen;
  };

  const out = new Map<string, PreparationImpact>();
  for (const dish of input.dishes) {
    for (const id of closure(dish.component_ids)) {
      const row = out.get(id) ?? { dishes: 0, net_sales: 0, share_pct: 0 };
      row.dishes += 1;
      row.net_sales += dish.net_sales;
      out.set(id, row);
    }
  }
  for (const row of out.values()) {
    row.net_sales = Math.round(row.net_sales * 100) / 100;
    row.share_pct =
      input.totalNetSales > 0
        ? Math.round((row.net_sales / input.totalNetSales) * 1000) / 10
        : 0;
  }
  return out;
}

/** Spanish one-liner used on the list:
 *  "Desbloquea 7 platos · 24% de ventas de comida". */
export function impactLabel(
  impact: PreparationImpact | undefined,
  lang: PreferredLanguage = "es"
): string {
  const d = getDictionary(lang).menu.editor.preparations;
  if (!impact || impact.dishes === 0) return d.impactNone;
  const dishes = `${impact.dishes} ${impact.dishes === 1 ? d.impactDishOne : d.impactDishOther}`;
  return fmt(d.impactLabel, {
    dishes,
    pct: impact.share_pct.toLocaleString(localeFor(lang), {
      maximumFractionDigits: 1,
    }),
  });
}
