// lib/restaurant/rentabilidad-copy.ts
//
// Copy of the Rentabilidad page (es / en / de), built from templates over real
// numbers (no AI). Pure, so the sentences are unit-tested. The words live in
// lib/i18n/{es,en,de}/rentabilidad.ts. «plato», never «platillo». Spanish and
// German percentages use a comma (60,8%), English a point. Every function
// takes the language last and defaults to Spanish.

import type {
  ComparisonChips,
  MiltonFinding,
  RentabilidadMonth,
} from "@/lib/restaurant/rentabilidad";
import { previousMonthStart } from "@/lib/restaurant/fixed-costs";
import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

const dict = (lang: PreferredLanguage) => getDictionary(lang).rentabilidad;

export type Money = (n: number) => string;

/** `2026-10-01` → «octubre». */
export function monthNameEs(
  month: string,
  lang: PreferredLanguage = "es"
): string {
  return dict(lang).months[Number(month.slice(5, 7)) - 1] ?? month;
}

/** `2026-10-01` → «octubre 2026». */
export function monthLabelEs(
  month: string,
  lang: PreferredLanguage = "es"
): string {
  return fmt(dict(lang).monthLabel, {
    month: monthNameEs(month, lang),
    year: month.slice(0, 4),
  });
}

/** ISO weekday → «lunes». */
export function weekdayEs(
  weekday: number,
  lang: PreferredLanguage = "es"
): string {
  return dict(lang).weekdays[weekday - 1] ?? "";
}

/** Short ISO weekday → «Lun». */
export function weekdayShort(
  weekday: number,
  lang: PreferredLanguage = "es"
): string {
  return dict(lang).weekdaysShort[weekday - 1] ?? "";
}

/** Plural for «los …»: lunes → lunes, sábado → sábados. */
export function weekdayPlural(
  weekday: number,
  lang: PreferredLanguage = "es"
): string {
  return dict(lang).weekdaysPlural[weekday - 1] ?? "";
}

/** 0.608 → «60,8%»; a whole number drops the decimal («31%»). */
export function pctText(
  fraction: number,
  digits = 1,
  lang: PreferredLanguage = "es"
): string {
  const value = (fraction * 100).toFixed(digits);
  const trimmed = digits > 0 ? value.replace(/\.0+$/, "") : value;
  return `${lang === "en" ? trimmed : trimmed.replace(".", ",")}%`;
}

/** A percent already in 0–100 («31.0» → «31,0%»), as in the «cada $100» bar. */
export function pointsText(
  points: number,
  lang: PreferredLanguage = "es"
): string {
  const v = points.toFixed(1);
  return `${lang === "en" ? v : v.replace(".", ",")}%`;
}

/** «lunes 26» for `2026-10-26`. */
export function dayLabelEs(
  date: string,
  lang: PreferredLanguage = "es"
): string {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const weekday = js === 0 ? 7 : js;
  return fmt(dict(lang).dayLabel, {
    weekday: weekdayEs(weekday, lang),
    day: d,
  });
}

/** «lunes y martes», «lunes, martes y sábados» (plural names). */
export function listPlural(
  weekdays: readonly number[],
  lang: PreferredLanguage = "es"
): string {
  const names = weekdays.map((w) => weekdayPlural(w, lang));
  if (names.length <= 1) return names[0] ?? "";
  const and = lang === "en" ? "and" : lang === "de" ? "und" : "y";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/** The only sentence left of the old headline: an empty month. */
export function emptyMonthSentence(
  month: string,
  lang: PreferredLanguage = "es"
): string {
  return fmt(dict(lang).copy.emptyMonth, { month: monthNameEs(month, lang) });
}

export function chipTexts(
  chips: ComparisonChips | null,
  month: string,
  money: Money,
  lang: PreferredLanguage = "es"
): Array<{ tone: "good" | "bad" | "neutral"; text: string }> {
  if (!chips) return [];
  const c = dict(lang).copy;
  const prev = monthNameEs(previousMonthStart(month), lang);
  const out: Array<{ tone: "good" | "bad" | "neutral"; text: string }> = [];
  if (chips.daysEarlier !== null) {
    const n = Math.abs(chips.daysEarlier);
    if (n === 0)
      out.push({ tone: "neutral", text: fmt(c.coverSameDay, { prev }) });
    else {
      const earlier = chips.daysEarlier > 0;
      const template = earlier
        ? n === 1
          ? c.coverEarlierOne
          : c.coverEarlierOther
        : n === 1
          ? c.coverLaterOne
          : c.coverLaterOther;
      out.push({
        tone: earlier ? "good" : "bad",
        text: fmt(template, { n, prev }),
      });
    }
  }
  if (chips.profitDelta !== null) {
    const d = chips.profitDelta;
    out.push(
      d === 0
        ? { tone: "neutral", text: fmt(c.sameAsPrev, { prev }) }
        : {
            tone: d > 0 ? "good" : "bad",
            text: `${d > 0 ? "▲" : "▼"} ${fmt(
              d > 0 ? c.profitMore : c.profitLess,
              { amount: money(Math.abs(d)), prev }
            )}`,
          }
    );
  }
  return out;
}

/** Tooltip only: how a projected day is estimated. */
export function projectionMethod(lang: PreferredLanguage = "es"): string {
  return dict(lang).copy.projectionMethod;
}

export function noSummaryText(lang: PreferredLanguage = "es"): string {
  return dict(lang).copy.noSummary;
}

/** Spanish defaults, kept for callers that have no language. */
export const PROJECTION_METHOD = projectionMethod("es");
export const NO_SUMMARY_TEXT = noSummaryText("es");

/** One line of the «Resumen de Milton»: a template over computed numbers. */
export function findingText(
  f: MiltonFinding,
  m: RentabilidadMonth,
  money: Money,
  lang: PreferredLanguage = "es"
): string {
  const c = dict(lang).copy;
  switch (f.kind) {
    case "coverage":
      return c.findingCoverage;
    case "cost_share_change": {
      const { now, before } = f.amounts;
      return fmt(now > before ? c.findingCostUp : c.findingCostDown, {
        before,
        now,
        prev: monthNameEs(previousMonthStart(m.month), lang),
      });
    }
    case "days_below": {
      const { total, below, breakEven, weakestAvg } = f.amounts;
      const be = fmt(
        f.estimated ? c.breakEvenAmountEstimated : c.breakEvenAmount,
        { amount: money(breakEven) }
      );
      const head =
        below > 0
          ? fmt(c.daysBelow, { below, total, be })
          : fmt(c.daysBelowNone, { be });
      return f.weekday !== undefined && weakestAvg !== undefined
        ? fmt(c.weakestDay, {
            head,
            days: weekdayPlural(f.weekday, lang),
            amount: money(weakestAvg),
          })
        : head;
    }
    case "projection":
      return f.amounts.profit < 0 ? c.projectionLoss : c.projectionProfit;
  }
}
