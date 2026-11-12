// What the Inicio cards say, as plain data (pure and tested). Every figure is
// one the server already sent and the other tabs show; this file only decides
// the words. A missing figure is never «—» or 0: it is a short reason plus the
// next step, in the same wording as Costos and Rentabilidad.

import { fmt, type Language } from "../i18n/strings";
import {
  deltaOf,
  formatFraction,
  formatMoney,
  formatWeekday,
  monthLabel,
  monthName,
  type Delta,
} from "./format";
import { foodCostView, missingForMonth } from "./costs-core";
import type { GestionStrings } from "./strings";
import type { DataReasons, HomeData } from "./types";

export type CardKey = "sales" | "profit" | "food" | "staff";

/** A card: a figure (with a chip / note) or the reason it is missing. */
export interface CardView {
  key: CardKey;
  label: string;
  /** The formatted figure; null = show `reason` and `next` instead. */
  value: string | null;
  /** Small coloured chip under the figure («+9 % vs. …», «10 % de margen»). */
  chip: { text: string; tone: Delta["tone"] | "mint" } | null;
  /** Grey line under the figure (month it is about, coverage). */
  note: string | null;
  reason: string | null;
  next: string | null;
  /** The tab the card opens. */
  link: "/ventas" | "/rentabilidad" | "/costos";
}

/**
 * «+9 % vs. lun. pasado»: the delta and the weekday the comparison is against
 * (Ayer compares with the same weekday last week). Short enough for an iPhone
 * SE; the chip also wraps, so it is never cut with «…». null = no comparison.
 */
export function yesterdayChip(args: {
  delta: number | null | undefined;
  date: string;
  lang: Language;
  g: GestionStrings;
}): { text: string; tone: Delta["tone"] } | null {
  const d = deltaOf(args.delta, args.lang);
  if (d.text === null) return null;
  return {
    text: fmt(args.g.home.vsWeekday, {
      delta: d.text,
      weekday: formatWeekday(args.date, args.lang),
    }),
    tone: d.tone,
  };
}

type Cards = NonNullable<HomeData["cards"]>;

export function salesCard(args: {
  cards: Cards;
  currency: string;
  lang: Language;
  g: GestionStrings;
}): CardView {
  const { cards, currency, lang, g } = args;
  const s = cards.sales;
  const base = {
    key: "sales" as const,
    label: g.home.salesCard,
    link: "/ventas" as const,
  };
  if (!s || s.value === null) {
    return {
      ...base,
      value: null,
      chip: null,
      note: null,
      reason: g.home.salesNone,
      next: g.home.salesNoneNext,
    };
  }
  const d = deltaOf(s.delta, lang);
  return {
    ...base,
    value: formatMoney(s.value, currency, lang),
    chip:
      d.text === null
        ? null
        : { text: fmt(g.home.salesVsPrior, { delta: d.text }), tone: d.tone },
    note: null,
    reason: null,
    next: null,
  };
}

/** «Ganancia del mes», or the latest month with data (labelled), or why not. */
export function profitCard(args: {
  cards: Cards;
  currency: string;
  lang: Language;
  g: GestionStrings;
}): CardView {
  const { cards, currency, lang, g } = args;
  const p = cards.profit;
  const base = {
    key: "profit" as const,
    label: g.home.monthProfit,
    link: "/rentabilidad" as const,
  };
  if (p) {
    return {
      ...base,
      value: formatMoney(p.value, currency, lang),
      chip:
        p.pct === null
          ? null
          : {
              text: fmt(g.home.marginChip, {
                pct: formatFraction(p.pct, lang),
              }),
              tone: "mint",
            },
      note: p.isLatest
        ? fmt(g.profit.latestMonth, { month: monthLabel(p.month, lang) })
        : p.basis === "estimada"
          ? g.home.estimated
          : null,
      reason: null,
      next: null,
    };
  }
  const first = cards.month
    ? missingForMonth({
        reasons: cards.reasons ?? undefined,
        month: cards.month,
        g,
        lang,
      })[0]
    : undefined;
  return {
    ...base,
    value: null,
    chip: null,
    note: null,
    reason: first ?? g.home.noProfitNext,
    next: null,
  };
}

/** «Costo de comida»: the very figure and coverage note of Costos' «Costo de ventas». */
export function foodCard(args: {
  cards: Cards;
  lang: Language;
  g: GestionStrings;
}): CardView {
  const { cards, lang, g } = args;
  const v = foodCostView({
    pct: cards.foodCostPct,
    reasons: cards.reasons ?? undefined,
    month: cards.month ?? "",
    g,
    lang,
  });
  return {
    key: "food",
    label: g.home.foodCard,
    value: v.value === null ? null : formatFraction(v.value / 100, lang),
    chip: null,
    note: v.value === null ? null : (v.note ?? g.home.ofSales),
    // One short line: the per-reason breakdown stays on Costos.
    reason:
      cards.reasons?.foodCost.status === "no_costed_dishes"
        ? g.costs.noCostedDishes
        : v.reason,
    next: v.next,
    link: "/costos",
  };
}

/** «Costo de personal»: planilla ÷ the month's sales (the web's planillaPct). */
export function staffCard(args: {
  cards: Cards;
  lang: Language;
  g: GestionStrings;
}): CardView {
  const { cards, lang, g } = args;
  const r: DataReasons | null = cards.reasons;
  const m = cards.month ? monthName(cards.month, lang) : "";
  const base = {
    key: "staff" as const,
    label: g.home.staffCard,
    chip: null,
    link: "/costos" as const,
  };
  const pct = r?.staff?.pct ?? null;
  if (pct !== null) {
    return {
      ...base,
      value: formatFraction(pct, lang),
      note: g.home.ofSales,
      reason: null,
      next: null,
    };
  }
  if (r && r.staff && !r.staff.loaded) {
    return {
      ...base,
      value: null,
      note: null,
      reason: fmt(g.home.staffNone, { month: m }),
      next: g.home.staffNoneNext,
    };
  }
  if (r && !r.hasSales) {
    return {
      ...base,
      value: null,
      note: null,
      reason: fmt(g.costs.reasonNoSales, { month: m }),
      next: g.costs.reasonNoSalesNext,
    };
  }
  // An older server that does not say why.
  return {
    ...base,
    value: null,
    note: null,
    reason: g.costs.kpisNoData,
    next: null,
  };
}
