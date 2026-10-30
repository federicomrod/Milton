// lib/restaurant/cockpit-insights.ts
//
// The backend picks and calculates at most 3 Cockpit insights.
// OpenAI only words them. If the model invents a number that is not in
// the facts, that insight falls back to the deterministic Spanish/English
// sentence. Metric names match the owners' email briefing.

import {
  localeFor,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { COSTS_HREF, MENU_HREF } from "@/lib/restaurant/navigation";
import {
  cockpitComparisonPhrases,
  formatCockpitMoney,
  polishCockpitCopy,
  type CockpitPeriodSnapshot,
  type DailyNetPoint,
} from "@/lib/restaurant/cockpit-executive";

export const MAX_COCKPIT_INSIGHTS = 3;
export const AI_TITLE_MAX_LEN = 80;
export const AI_BODY_MAX_LEN = 280;

export const AI_INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the )?(previous|above|prior) instructions/i,
  /system prompt/i,
  /you are now/i,
  /```/,
  /<script/i,
  /javascript:/i,
  /\[INST\]/i,
  /<\|.*?\|>/,
];

const URL_RE = /https?:\/\/|www\./i;
const UP_WORDS =
  /subi(?:o|ó|eron)|aument(?:o|ó|aron)|creci(?:o|ó|eron)|arriba|higher|rose|increased|grew|\bstieg|gestiegen|\bsteigt|\bplus\b|höher|zugenommen/i;
const DOWN_WORDS =
  /baj(?:o|ó|aron)|cay(?:o|ó|eron)|abajo|disminuy(?:o|ó|eron)|decreased|fell|dropped|\bdown\b|\bsank|gesunken|\bsinkt|\bminus\b|niedriger|abgenommen|\bfiel\b|gefallen/i;

export type CockpitInsightKind =
  | "data_health_costs"
  | "missing_recipes"
  | "low_margin_dish"
  | "best_day"
  | "worst_day"
  | "channel_shift"
  | "ticket_change"
  | "sales_change"
  | "kitchen_most_reported"
  | "kitchen_peak_hour"
  | "kitchen_staff_active";

export interface CockpitInsightFact {
  id: string;
  kind: CockpitInsightKind;
  score: number;
  facts: Record<string, number | string | null>;
  title: string;
  body: string;
  action?: { label: string; href: string };
}

export interface WordedCockpitInsight {
  id: string;
  kind: CockpitInsightKind;
  title: string;
  body: string;
  action?: { label: string; href: string };
  facts: Record<string, number | string | null>;
}

export interface CockpitInsightContext {
  lowMarginDish?: { name: string; margin_pct: number } | null;
  dishesWithoutRecipe?: number;
}

const KIND_ORDER: CockpitInsightKind[] = [
  "data_health_costs",
  "missing_recipes",
  "low_margin_dish",
  "best_day",
  "worst_day",
  "channel_shift",
  "ticket_change",
  "sales_change",
];

export function isPartialAnchorDay(
  day: DailyNetPoint,
  daysWithSales: DailyNetPoint[],
  snapshot: CockpitPeriodSnapshot
): boolean {
  if (day.date !== snapshot.period.current.to) return false;
  const others = daysWithSales.filter((d) => d.date !== day.date);
  if (others.length === 0) return true;
  const sorted = others.map((d) => d.current_tickets).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const thinVsMedian = day.current_tickets < median * 0.5;
  // Complete months keep a full last day unless it is clearly thin.
  // last_7 / month-to-date treat the latest synced day as in-progress.
  if (snapshot.period.month_complete) return thinVsMedian;
  return true;
}

export function selectCockpitInsights(
  snapshot: CockpitPeriodSnapshot,
  lang: PreferredLanguage,
  context: CockpitInsightContext = {}
): CockpitInsightFact[] {
  const candidates: CockpitInsightFact[] = [];
  const phrases = cockpitComparisonPhrases(snapshot.period, lang);
  const money = (n: number) =>
    formatCockpitMoney(n, snapshot.currency, 0, lang);

  if (snapshot.cost.coverage_pct <= 0) {
    candidates.push({
      id: "data_health_costs",
      kind: "data_health_costs",
      score: 1000,
      facts: {
        cost_coverage_pct: snapshot.cost.coverage_pct,
        net_sales: round2(snapshot.current.net_sales),
      },
      title: polishInsight(
        lang,
        t(
          lang,
          "Recipe costs are still missing",
          "Todavía faltan los costos de recetas",
          "Rezeptkosten fehlen noch"
        )
      ),
      body: polishInsight(
        lang,
        t(
          lang,
          `Cost coverage is ${snapshot.cost.coverage_pct.toFixed(1)}% of net sales. Gross margin % and food cost % stay hidden until dishes have a cost.`,
          `La cobertura de costos es ${snapshot.cost.coverage_pct.toFixed(1)}% de las ventas netas. El margen bruto % y el % de costo de comida se ocultan hasta que los platos tengan costo.`,
          `Die Kostenabdeckung beträgt ${snapshot.cost.coverage_pct.toFixed(1)} % des Nettoumsatzes. Rohmarge % und Wareneinsatz % bleiben ausgeblendet, bis Gerichte Kosten haben.`
        )
      ),
      action: {
        label: t(lang, "Add costs", "Agregar costos", "Kosten hinzufügen"),
        href: `${COSTS_HREF}/upload`,
      },
    });
  } else if ((context.dishesWithoutRecipe ?? 0) > 0) {
    const missing = context.dishesWithoutRecipe ?? 0;
    candidates.push({
      id: "missing_recipes",
      kind: "missing_recipes",
      score: 900,
      facts: {
        dishes_without_recipe: missing,
        cost_coverage_pct: snapshot.cost.coverage_pct,
      },
      title: polishInsight(
        lang,
        t(
          lang,
          "Sold dishes are still missing recipes",
          "Todavía faltan recetas en platos vendidos",
          "Bei verkauften Gerichten fehlen noch Rezepte"
        )
      ),
      body: polishInsight(
        lang,
        t(
          lang,
          `${missing} sold dishes have no recipe, so their cost stays hidden.`,
          `${missing} ${missing === 1 ? "plato vendido no tiene receta" : "platos vendidos no tienen receta"}, así que su costo sigue oculto.`,
          `${missing} ${missing === 1 ? "verkauftes Gericht hat" : "verkaufte Gerichte haben"} kein Rezept, daher bleiben die Kosten ausgeblendet.`
        )
      ),
      action: {
        label: t(lang, "Add recipes", "Agregar recetas", "Rezepte hinzufügen"),
        href: MENU_HREF,
      },
    });
  }

  if (context.lowMarginDish && snapshot.cost.coverage_pct > 0) {
    const dish = context.lowMarginDish;
    candidates.push({
      id: "low_margin_dish",
      kind: "low_margin_dish",
      score: 85,
      facts: {
        name: dish.name,
        margin_pct: round1(dish.margin_pct),
      },
      title: polishInsight(
        lang,
        t(
          lang,
          "A dish is running a thin margin",
          "Un plato tiene margen bajo",
          "Ein Gericht hat eine niedrige Marge"
        )
      ),
      body: polishInsight(
        lang,
        t(
          lang,
          `${dish.name} is at ${dish.margin_pct.toFixed(1)}% gross margin.`,
          `${dish.name} está en ${dish.margin_pct.toFixed(1)}% de margen bruto.`,
          `${dish.name} liegt bei ${dish.margin_pct.toFixed(1)} % Rohmarge.`
        )
      ),
      action: {
        label: t(lang, "Review the dish", "Revisar el plato", "Gericht prüfen"),
        href: MENU_HREF,
      },
    });
  }

  const daysWithSales = snapshot.daily.filter((d) => d.current_net > 0);
  const partialAnchor = daysWithSales.find((d) =>
    isPartialAnchorDay(d, daysWithSales, snapshot)
  );
  const rankedDays = daysWithSales.filter(
    (d) => !isPartialAnchorDay(d, daysWithSales, snapshot)
  );
  const soFar =
    partialAnchor !== undefined
      ? t(lang, " so far", " hasta ahora", " bisher")
      : "";
  if (rankedDays.length >= 3) {
    const avg =
      rankedDays.reduce((s, d) => s + d.current_net, 0) / rankedDays.length;
    const best = rankedDays.reduce((a, b) =>
      b.current_net > a.current_net ? b : a
    );
    const worst = rankedDays.reduce((a, b) =>
      b.current_net < a.current_net ? b : a
    );
    const bestDev = avg > 0 ? (best.current_net - avg) / avg : 0;
    const worstDev = avg > 0 ? (worst.current_net - avg) / avg : 0;
    if (bestDev >= 0.1) {
      const weekday = weekdayLabel(best.date, lang);
      candidates.push({
        id: `best_day_${best.date}`,
        kind: "best_day",
        score: Math.round(Math.abs(bestDev) * 100),
        facts: {
          date: best.date,
          weekday,
          net: round2(best.current_net),
          average: round2(avg),
          vs_average_pct: round1(bestDev * 100),
          tickets: best.current_tickets,
          partial_anchor_excluded: partialAnchor ? 1 : 0,
        },
        title: polishInsight(
          lang,
          t(
            lang,
            `${weekday} was the strongest day${soFar}`,
            `El ${weekday} fue el mejor día${soFar}`,
            `${weekday} war der stärkste Tag${soFar}`
          )
        ),
        body: polishInsight(
          lang,
          t(
            lang,
            `${weekday} did ${money(best.current_net)} in net sales, ${(bestDev * 100).toFixed(1)}% above the daily average of ${money(avg)}.`,
            `${weekday} hizo ${money(best.current_net)} en ventas netas, ${(bestDev * 100).toFixed(1)}% arriba del promedio diario de ${money(avg)}.`,
            `${weekday} erzielte ${money(best.current_net)} Nettoumsatz, ${(bestDev * 100).toFixed(1)} % über dem Tagesdurchschnitt von ${money(avg)}.`
          )
        ),
      });
    }
    if (worstDev <= -0.1 && worst.date !== best.date) {
      const weekday = weekdayLabel(worst.date, lang);
      candidates.push({
        id: `worst_day_${worst.date}`,
        kind: "worst_day",
        score: Math.round(Math.abs(worstDev) * 100),
        facts: {
          date: worst.date,
          weekday,
          net: round2(worst.current_net),
          average: round2(avg),
          vs_average_pct: round1(worstDev * 100),
          tickets: worst.current_tickets,
          partial_anchor_excluded: partialAnchor ? 1 : 0,
        },
        title: polishInsight(
          lang,
          t(
            lang,
            `${weekday} was the softest day${soFar}`,
            `El ${weekday} fue el día más flojo${soFar}`,
            `${weekday} war der schwächste Tag${soFar}`
          )
        ),
        body: polishInsight(
          lang,
          t(
            lang,
            `${weekday} did ${money(worst.current_net)} in net sales, ${Math.abs(worstDev * 100).toFixed(1)}% below the daily average of ${money(avg)}.`,
            `${weekday} hizo ${money(worst.current_net)} en ventas netas, ${Math.abs(worstDev * 100).toFixed(1)}% abajo del promedio diario de ${money(avg)}.`,
            `${weekday} erzielte ${money(worst.current_net)} Nettoumsatz, ${Math.abs(worstDev * 100).toFixed(1)} % unter dem Tagesdurchschnitt von ${money(avg)}.`
          )
        ),
      });
    }
  }

  const shifted = snapshot.channels
    .filter((c) => c.delta_pp !== null && Math.abs(c.delta_pp) >= 3)
    .sort((a, b) => Math.abs(b.delta_pp ?? 0) - Math.abs(a.delta_pp ?? 0))[0];
  if (shifted && shifted.delta_pp !== null) {
    const up = shifted.delta_pp > 0;
    candidates.push({
      id: `channel_${shifted.channel}`,
      kind: "channel_shift",
      score: Math.round(Math.abs(shifted.delta_pp) * 10),
      facts: {
        channel: shifted.label,
        share_pct: shifted.share_pct,
        previous_share_pct: shifted.previous_share_pct,
        delta_pp: shifted.delta_pp,
        net_sales: shifted.net_sales,
      },
      title: polishInsight(
        lang,
        t(
          lang,
          `${shifted.label} share shifted`,
          `Cambió la participación de ${shifted.label}`,
          `Der Anteil von ${shifted.label} hat sich verschoben`
        )
      ),
      body: polishInsight(
        lang,
        t(
          lang,
          `${shifted.label} is ${shifted.share_pct.toFixed(1)}% of net sales (${up ? "+" : ""}${shifted.delta_pp.toFixed(1)} pp vs the previous period).`,
          `${shifted.label} es el ${shifted.share_pct.toFixed(1)}% de las ventas netas (${up ? "+" : ""}${shifted.delta_pp.toFixed(1)} pp frente al periodo anterior).`,
          `${shifted.label} macht ${shifted.share_pct.toFixed(1)} % des Nettoumsatzes aus (${up ? "+" : ""}${shifted.delta_pp.toFixed(1)} pp ggü. Vorperiode).`
        )
      ),
    });
  }

  const ticketDelta = deltaFrom(
    snapshot.current.avg_ticket,
    snapshot.previous.avg_ticket
  );
  if (ticketDelta !== null && Math.abs(ticketDelta) >= 5) {
    candidates.push({
      id: "ticket_change",
      kind: "ticket_change",
      score: Math.round(Math.abs(ticketDelta)),
      facts: {
        avg_ticket: round2(snapshot.current.avg_ticket),
        previous_avg_ticket: round2(snapshot.previous.avg_ticket),
        delta_pct: ticketDelta,
        tickets: snapshot.current.tickets,
      },
      title: polishInsight(
        lang,
        t(
          lang,
          "Average ticket moved",
          "El ticket promedio se movió",
          "Der Ø Bon hat sich verändert"
        )
      ),
      body: polishInsight(
        lang,
        t(
          lang,
          `Average ticket is ${money(snapshot.current.avg_ticket)}, ${ticketDelta > 0 ? "up" : "down"} ${Math.abs(ticketDelta).toFixed(1)}% versus the previous period, across ${snapshot.current.tickets} tickets.`,
          `El ticket promedio es ${money(snapshot.current.avg_ticket)}, ${ticketDelta > 0 ? "sube" : "baja"} ${Math.abs(ticketDelta).toFixed(1)}% frente al periodo anterior, en ${snapshot.current.tickets} tickets.`,
          `Der Ø Bon beträgt ${money(snapshot.current.avg_ticket)}, ${ticketDelta > 0 ? "plus" : "minus"} ${Math.abs(ticketDelta).toFixed(1)} % ggü. der Vorperiode, bei ${snapshot.current.tickets} Bons.`
        )
      ),
    });
  }

  const salesDelta = deltaFrom(
    snapshot.current.net_sales,
    snapshot.previous.net_sales
  );
  if (salesDelta !== null && Math.abs(salesDelta) >= 5) {
    const verb =
      salesDelta > 0
        ? t(lang, "rose", "subieron", "stieg")
        : t(lang, "fell", "bajaron", "sank");
    const tipsNote =
      snapshot.current.tips > 0
        ? t(
            lang,
            ` Tips ${money(snapshot.current.tips)} stay on their own line.`,
            ` Las propinas ${money(snapshot.current.tips)} siguen en su propia línea.`,
            ` Das Trinkgeld ${money(snapshot.current.tips)} wird separat ausgewiesen.`
          )
        : "";
    candidates.push({
      id: "sales_change",
      kind: "sales_change",
      score: Math.round(Math.abs(salesDelta)),
      facts: {
        net_sales: round2(snapshot.current.net_sales),
        previous_net_sales: round2(snapshot.previous.net_sales),
        delta_pct: salesDelta,
        tips: round2(snapshot.current.tips),
      },
      title: polishInsight(
        lang,
        t(
          lang,
          "Net sales versus the previous stretch",
          "Ventas netas frente al tramo anterior",
          "Nettoumsatz gegenüber dem vorherigen Abschnitt"
        )
      ),
      body: polishInsight(
        lang,
        t(
          lang,
          `Net sales ${verb} to ${money(snapshot.current.net_sales)}, ${Math.abs(salesDelta).toFixed(1)}% ${phrases.frenteAPrevious}.${tipsNote}`,
          `Las ventas netas ${verb} a ${money(snapshot.current.net_sales)}, ${Math.abs(salesDelta).toFixed(1)}% ${phrases.frenteAPrevious}.${tipsNote}`,
          `Der Nettoumsatz ${verb} auf ${money(snapshot.current.net_sales)} (${Math.abs(salesDelta).toFixed(1)} % ${phrases.frenteAPrevious}).${tipsNote}`
        )
      ),
    });
  }

  return candidates
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    })
    .slice(0, MAX_COCKPIT_INSIGHTS);
}

export function wordedFromFacts(
  facts: CockpitInsightFact[]
): WordedCockpitInsight[] {
  return facts.slice(0, MAX_COCKPIT_INSIGHTS).map((fact) => {
    const lang = titleLangGuess(fact.title);
    return {
      id: fact.id,
      kind: fact.kind,
      title: polishInsight(lang, fact.title),
      body: polishInsight(lang, fact.body),
      action: fact.action,
      facts: fact.facts,
    };
  });
}

/**
 * Every numeric token in `text` must appear among the fact values
 * (raw or commonly formatted). Extra numbers → not grounded.
 */
export function aiWordingIsGrounded(
  text: string,
  facts: Record<string, number | string | null>
): boolean {
  const allowed = allowedNumberTokens(facts);
  const used = extractNumberTokens(stripHarmlessPeriodCounts(text));
  return used.every((token) => allowed.has(token));
}

export function textHasInjectionPattern(text: string): boolean {
  return AI_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function directionContradictsDelta(
  text: string,
  facts: Record<string, number | string | null>
): boolean {
  const delta = signedFact(facts);
  if (delta === null || delta === 0) return false;
  const hasUp = UP_WORDS.test(text);
  const hasDown = DOWN_WORDS.test(text);
  if (delta > 0 && hasDown && !hasUp) return true;
  if (delta < 0 && hasUp && !hasDown) return true;
  return false;
}

export function aiWordingPassesGuards(
  title: string,
  body: string,
  facts: Record<string, number | string | null>
): boolean {
  if (title.trim().length === 0 || body.trim().length === 0) return false;
  if (title.length > AI_TITLE_MAX_LEN || body.length > AI_BODY_MAX_LEN) {
    return false;
  }
  const combined = `${title} ${body}`;
  if (URL_RE.test(combined)) return false;
  if (directionContradictsDelta(combined, facts)) return false;
  const digits = extractNumberTokens(stripHarmlessPeriodCounts(combined));
  if (digits.length === 0) {
    return !textHasInjectionPattern(combined);
  }
  if (textHasInjectionPattern(combined)) return false;
  return aiWordingIsGrounded(combined, facts);
}

export function applyAiWordingOrFallback(
  facts: CockpitInsightFact[],
  ai: Array<{ id?: unknown; title?: unknown; body?: unknown }> | null
): { insights: WordedCockpitInsight[]; usedFallback: boolean } {
  const fallback = wordedFromFacts(facts);
  if (!ai || !Array.isArray(ai)) {
    return { insights: fallback, usedFallback: true };
  }
  let usedFallback = false;
  const insights = fallback.map((base) => {
    const match = ai.find((row) => row && row.id === base.id);
    if (
      !match ||
      typeof match.title !== "string" ||
      typeof match.body !== "string"
    ) {
      usedFallback = true;
      return base;
    }
    if (!aiWordingPassesGuards(match.title, match.body, base.facts)) {
      usedFallback = true;
      return base;
    }
    const lang = titleLangGuess(match.title);
    return {
      ...base,
      title: polishInsight(lang, match.title.trim()),
      body: polishInsight(lang, match.body.trim()),
    };
  });
  return { insights, usedFallback };
}

export function extractNumberTokens(text: string): string[] {
  const matches = text.match(/[-+]?\d[\d.,]*/g) ?? [];
  return matches.map(normalizeNumberToken).filter((token) => token.length > 0);
}

export function capitalizeInsightTitle(
  title: string,
  lang: PreferredLanguage
): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;
  const locale = localeFor(lang);
  return trimmed.charAt(0).toLocaleUpperCase(locale) + trimmed.slice(1);
}

function polishInsight(lang: PreferredLanguage, text: string): string {
  return polishCockpitCopy(lang, capitalizeInsightTitle(text, lang));
}

/** "7 días" is period language, not an invented KPI figure. */
function stripHarmlessPeriodCounts(text: string): string {
  return text.replace(/\b\d+\s*(?:días|tage[n]?)\b/gi, "");
}

function allowedNumberTokens(
  facts: Record<string, number | string | null>
): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(facts)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      addNumberVariants(out, value);
    } else if (typeof value === "string") {
      for (const token of extractNumberTokens(value)) out.add(token);
    }
  }
  return out;
}

function addNumberVariants(out: Set<string>, n: number) {
  out.add(normalizeNumberToken(String(n)));
  out.add(normalizeNumberToken(n.toFixed(0)));
  out.add(normalizeNumberToken(n.toFixed(1)));
  out.add(normalizeNumberToken(n.toFixed(2)));
  out.add(normalizeNumberToken(Math.round(n).toString()));
  const abs = Math.abs(n);
  out.add(normalizeNumberToken(abs.toFixed(1)));
  out.add(normalizeNumberToken(abs.toFixed(0)));
}

export function normalizeNumberToken(raw: string): string {
  let s = raw.replace(/[+%\s$]/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d+$/.test(s)) {
    s = s.replace(",", ".");
  }
  if (s.includes(".")) {
    s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  if (s === "-0") return "0";
  return s;
}

function weekdayLabel(dateKey: string, lang: PreferredLanguage): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  );
  return new Intl.DateTimeFormat(localeFor(lang), {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function deltaFrom(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function signedFact(
  facts: Record<string, number | string | null>
): number | null {
  for (const key of ["delta_pct", "vs_average_pct", "delta_pp"]) {
    const value = facts[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function titleLangGuess(title: string): PreferredLanguage {
  if (/[äöüß]|\b(?:der|die|das|und|ist|war|auf|ggü)\b/i.test(title))
    return "de";
  return /[áéíóúñ¿¡]|el |la |los |las |fue |del /i.test(title) ? "es" : "en";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
