// Dish margin rankings for Ask Milton — same costing as Menú › Resumen
// (cost / sale price, only «aprobado» platos). Platos without a recipe or
// price are excluded and counted as a caveat; they are never shown as 0%.

import type { AskMiltonContext } from "@/lib/restaurant/ask-milton-context";
import type { AskMiltonMenuDish } from "@/lib/restaurant/ask-milton-catalog";
import type {
  AskMiltonAnswer,
  AskMiltonRelatedLink,
} from "@/lib/restaurant/ask-milton-prompt";
import { parseRequestedCount } from "@/lib/restaurant/ask-milton-count";
import { displayName } from "@/lib/restaurant/sentence-case";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

/** List size when the question names no count. */
export const DEFAULT_RANKED = 5;

export type MarginDirection = "worst" | "best";

export interface DishFoodCostRow {
  name: string;
  food_cost_pct: number;
  /** Real margin from the costing (sale − cost) / sale; null when unknown. */
  margin_pct: number | null;
}

export function formatDishFoodCostPct(n: number): string {
  return `${Math.round(n)}%`;
}

function hasCost(pct: number | null | undefined): pct is number {
  return pct !== null && pct !== undefined && Number.isFinite(pct);
}

function isRankable(
  d: AskMiltonMenuDish
): d is AskMiltonMenuDish & { food_cost_pct: number } {
  return d.cost_status === "aprobado" && hasCost(d.food_cost_pct);
}

function toRow(d: AskMiltonMenuDish & { food_cost_pct: number }): DishFoodCostRow {
  return {
    name: displayName(d.name),
    food_cost_pct: d.food_cost_pct,
    margin_pct: hasCost(d.margin_pct) ? d.margin_pct : null,
  };
}

export function rankDishesByFoodCost(
  ctx: AskMiltonContext,
  count: number = DEFAULT_RANKED,
  direction: MarginDirection = "worst"
): {
  ranked: DishFoodCostRow[];
  uncosted: number;
} {
  const block = ctx.menu_dishes;
  if (!block) {
    return { ranked: [], uncosted: 0 };
  }
  // Older contexts carry only the worst list; the best list is then the
  // same rows read from the other end.
  const source =
    direction === "best"
      ? (block.top_by_margin ?? block.top_by_food_cost)
      : block.top_by_food_cost;
  const sign = direction === "worst" ? 1 : -1;
  const ranked = source
    .filter(isRankable)
    .sort(
      (a, b) =>
        sign * (b.food_cost_pct - a.food_cost_pct) ||
        a.name.localeCompare(b.name, "es")
    )
    .slice(0, Math.max(1, count))
    .map(toRow);
  return { ranked, uncosted: block.uncosted_count };
}

function uncostedCaveat(
  count: number,
  direction: MarginDirection,
  lang: PreferredLanguage
): string {
  if (count <= 0) return "";
  const worse = direction === "worst";
  return t(
    lang,
    count === 1
      ? `Note: 1 dish doesn't have a cost yet, so it could have a ${worse ? "lower" : "higher"} margin.`
      : `Note: ${count} dishes don't have a cost yet, so others could have a ${worse ? "lower" : "higher"} margin.`,
    count === 1
      ? `Ojo: 1 plato aún no tiene costo, así que podría tener ${worse ? "peor" : "mejor"} margen.`
      : `Ojo: ${count} platos aún no tienen costo, así que podría haber otros con ${worse ? "peor" : "mejor"} margen.`
  );
}

function header(
  shown: number,
  requested: number | null,
  direction: MarginDirection,
  lang: PreferredLanguage
): string {
  const worse = direction === "worst";
  const fewer = requested !== null && shown < requested;
  if (fewer) {
    return t(
      lang,
      shown === 1
        ? `Only 1 dish has an approved cost so far:`
        : `Only ${shown} dishes have an approved cost so far, here they are:`,
      shown === 1
        ? `Por ahora solo 1 plato tiene costo aprobado:`
        : `Por ahora solo ${shown} platos tienen costo aprobado, estos son:`
    );
  }
  if (shown === 1) {
    return t(
      lang,
      worse ? "Your dish with the lowest margin:" : "Your dish with the best margin:",
      worse ? "Tu plato con peor margen:" : "Tu plato con mejor margen:"
    );
  }
  return t(
    lang,
    worse
      ? `Your ${shown} dishes with the lowest margin:`
      : `Your ${shown} dishes with the best margin:`,
    worse
      ? `Tus ${shown} platos con peor margen:`
      : `Tus ${shown} platos con mejor margen:`
  );
}

/** «1. Queso fundido — margen 63% · costo 37% del precio» */
export function dishMarginLine(
  d: DishFoodCostRow,
  i: number,
  lang: PreferredLanguage
): string {
  const cost = formatDishFoodCostPct(d.food_cost_pct);
  const margin = d.margin_pct === null ? null : formatDishFoodCostPct(d.margin_pct);
  const detail = t(
    lang,
    margin ? `margin ${margin} · cost ${cost} of price` : `cost ${cost} of price`,
    margin ? `margen ${margin} · costo ${cost} del precio` : `costo ${cost} del precio`
  );
  return `${i + 1}. ${d.name} — ${detail}`;
}

export function dishFoodCostAnswer(
  ctx: AskMiltonContext,
  lang: PreferredLanguage,
  message = "",
  direction: MarginDirection = "worst"
): AskMiltonAnswer {
  const requested = parseRequestedCount(message);
  const { ranked, uncosted } = rankDishesByFoodCost(
    ctx,
    requested ?? DEFAULT_RANKED,
    direction
  );
  const links: AskMiltonRelatedLink[] = [
    {
      label: t(lang, "Dishes", "Platos"),
      href: "/dashboard/restaurant/menu/platos",
    },
    { label: t(lang, "Menu", "Menú"), href: "/dashboard/restaurant/menu" },
  ];
  const followups = [
    direction === "worst"
      ? t(
          lang,
          "Which ingredients are most expensive?",
          "¿Qué ingredientes salen más caros?"
        )
      : t(
          lang,
          "Which dishes have the lowest margin?",
          "¿Qué platos tienen peor margen?"
        ),
    t(
      lang,
      "Which dishes have missing recipes?",
      "¿Qué platos no tienen receta?"
    ),
  ];

  if (ranked.length === 0) {
    return {
      answer: [
        t(
          lang,
          "No dish has an approved cost yet, so I can't rank margins.",
          "Todavía ningún plato tiene costo aprobado, así que aún no puedo ordenarlos por margen."
        ),
        uncosted > 0
          ? t(
              lang,
              `${uncosted} dishes are waiting for a recipe or a price in Platos.`,
              `${uncosted} platos esperan receta o precio en Platos.`
            )
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      supporting_facts: [],
      related_links: links,
      suggested_followups: followups,
      confidence_notes: [],
    };
  }

  const lines = ranked.map((d, i) => dishMarginLine(d, i, lang));
  const caveat = uncostedCaveat(uncosted, direction, lang);
  return {
    answer: [
      header(ranked.length, requested, direction, lang),
      ...lines,
      ...(caveat ? ["", caveat] : []),
    ].join("\n"),
    supporting_facts: [],
    related_links: links,
    suggested_followups: followups,
    confidence_notes: [],
  };
}
