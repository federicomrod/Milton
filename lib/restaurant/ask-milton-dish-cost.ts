// Dish food-cost ranking for Ask Milton — same costing as Menú › Resumen
// (cost / sale price). Platos without a recipe or price are excluded and
// counted; they are never shown as 0%.

import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import type { AskMiltonMenuDish } from "@/lib/restaurant/ask-milton-catalog";
import type {
  AskMiltonAnswer,
  AskMiltonRelatedLink,
} from "@/lib/restaurant/ask-milton-prompt";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

const MAX_RANKED = 5;

export interface DishFoodCostRow {
  name: string;
  food_cost_pct: number;
}

export function formatDishFoodCostPct(n: number): string {
  return `${Math.round(n)}%`;
}

function hasCost(pct: number | null | undefined): pct is number {
  return pct !== null && pct !== undefined && Number.isFinite(pct);
}

function rankRows(
  rows: readonly { name: string; food_cost_pct: number }[]
): DishFoodCostRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.food_cost_pct - a.food_cost_pct || a.name.localeCompare(b.name, "es")
    )
    .slice(0, MAX_RANKED);
}

export function rankDishesByFoodCost(ctx: AskMiltonContext): {
  ranked: DishFoodCostRow[];
  uncosted: number;
} {
  const block = ctx.menu_dishes;
  if (block) {
    const ranked = rankRows(
      block.top_by_food_cost.filter(
        (
          d
        ): d is AskMiltonMenuDish & {
          food_cost_pct: number;
        } => hasCost(d.food_cost_pct)
      )
    );
    return { ranked, uncosted: block.uncosted_count };
  }

  const seen = new Set<string>();
  const collected: DishFoodCostRow[] = [];
  const add = (name: string, pct: number | null | undefined) => {
    if (!hasCost(pct) || seen.has(name)) return;
    seen.add(name);
    collected.push({ name, food_cost_pct: pct });
  };
  for (const item of ctx.briefing.high_food_cost_items) {
    add(item.name, item.food_cost_pct);
  }
  for (const item of ctx.menu.least_profitable_items) {
    add(item.name, item.food_cost_pct);
  }
  for (const item of ctx.menu.most_profitable_items) {
    add(item.name, item.food_cost_pct);
  }
  return {
    ranked: rankRows(collected),
    uncosted: ctx.briefing.data_quality.menu_items_without_recipe,
  };
}

function uncostedSentence(count: number, lang: PreferredLanguage): string {
  if (count <= 0) return "";
  return t(
    lang,
    count === 1
      ? "1 dish without cost yet."
      : `${count} dishes without cost yet.`,
    count === 1
      ? "1 plato sin costo todavía."
      : `${count} platos sin costo todavía.`
  );
}

export function dishFoodCostAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage
): AskMiltonAnswer {
  const { ranked, uncosted } = rankDishesByFoodCost(ctx);
  const links: AskMiltonRelatedLink[] = [
    {
      label: t(lang, "Dishes", "Platos"),
      href: "/dashboard/restaurant/menu/platos",
    },
    { label: t(lang, "Menu", "Menú"), href: "/dashboard/restaurant/menu" },
  ];
  const followups = [
    t(
      lang,
      "Which ingredients are most expensive?",
      "¿Qué ingredientes salen más caros?"
    ),
    t(
      lang,
      "Which dishes have missing recipes?",
      "¿Qué platos no tienen receta?"
    ),
  ];

  if (ranked.length === 0) {
    const missing = uncostedSentence(uncosted, lang);
    return {
      answer: [
        t(
          lang,
          "I don't have dishes with a food cost yet.",
          "Aún no hay platos con costo."
        ),
        missing,
      ]
        .filter(Boolean)
        .join(" "),
      supporting_facts: [],
      related_links: links,
      suggested_followups: followups,
      confidence_notes: [],
    };
  }

  const lines = ranked.map(
    (d, i) => `${i + 1}. ${d.name} — ${formatDishFoodCostPct(d.food_cost_pct)}`
  );
  const header = t(
    lang,
    "Dishes with the highest cost as % of sale price:",
    "Los platos con mayor costo sobre el precio de venta:"
  );
  const missing = uncostedSentence(uncosted, lang);
  return {
    answer: [header, ...lines, missing].filter(Boolean).join("\n"),
    supporting_facts: [],
    related_links: links,
    suggested_followups: followups,
    confidence_notes: [],
  };
}
