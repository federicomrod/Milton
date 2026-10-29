// lib/restaurant/rentabilidad-copy.ts
//
// Spanish copy of the Rentabilidad page, built from templates over real
// numbers (no AI). Pure, so the sentences are unit-tested. «plato», never
// «platillo». Percentages use a comma (60,8%).

import type {
  ComparisonChips,
  MiltonFinding,
  RentabilidadMonth,
} from "@/lib/restaurant/rentabilidad";
import { previousMonthStart } from "@/lib/restaurant/fixed-costs";

export type Money = (n: number) => string;

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const WEEKDAYS_ES = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];

/** `2026-10-01` → «octubre». */
export function monthNameEs(month: string): string {
  return MONTHS_ES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** `2026-10-01` → «octubre 2026». */
export function monthLabelEs(month: string): string {
  return `${monthNameEs(month)} ${month.slice(0, 4)}`;
}

/** ISO weekday → «lunes». */
export function weekdayEs(weekday: number): string {
  return WEEKDAYS_ES[weekday - 1] ?? "";
}

/** Plural for «los …»: lunes → lunes, sábado → sábados. */
export function weekdayPlural(weekday: number): string {
  const name = weekdayEs(weekday);
  return name.endsWith("s") ? name : `${name}s`;
}

/** 0.608 → «60,8%»; a whole number drops the decimal («31%»). */
export function pctText(fraction: number, digits = 1): string {
  const value = (fraction * 100).toFixed(digits);
  const trimmed = digits > 0 ? value.replace(/\.0+$/, "") : value;
  return `${trimmed.replace(".", ",")}%`;
}

/** A percent already in 0–100 («31.0» → «31,0%»), as in the «cada $100» bar. */
export function pointsText(points: number): string {
  return `${points.toFixed(1).replace(".", ",")}%`;
}

/** «lunes 26» for `2026-10-26`. */
export function dayLabelEs(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const weekday = js === 0 ? 7 : js;
  return `${weekdayEs(weekday)} ${d}`;
}

/** «lunes y martes», «lunes, martes y sábados» (plural names). */
export function listPlural(weekdays: readonly number[]): string {
  const names = weekdays.map(weekdayPlural);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** The only sentence left of the old headline: an empty month. */
export function emptyMonthSentence(month: string): string {
  return `Todavía no hay ventas de ${monthNameEs(month)} para calcular tu ganancia.`;
}

export function chipTexts(
  chips: ComparisonChips | null,
  month: string,
  money: Money
): Array<{ tone: "good" | "bad" | "neutral"; text: string }> {
  if (!chips) return [];
  const prev = monthNameEs(previousMonthStart(month));
  const out: Array<{ tone: "good" | "bad" | "neutral"; text: string }> = [];
  if (chips.daysEarlier !== null) {
    const n = Math.abs(chips.daysEarlier);
    if (n === 0)
      out.push({
        tone: "neutral",
        text: `Cubres tus costos el mismo día que en ${prev}`,
      });
    else
      out.push({
        tone: chips.daysEarlier > 0 ? "good" : "bad",
        text: `Cubres tus costos ${n} ${n === 1 ? "día" : "días"} ${
          chips.daysEarlier > 0 ? "antes" : "después"
        } que en ${prev}`,
      });
  }
  if (chips.profitDelta !== null) {
    const d = chips.profitDelta;
    out.push(
      d === 0
        ? { tone: "neutral", text: `Igual que en ${prev}` }
        : {
            tone: d > 0 ? "good" : "bad",
            text: `${d > 0 ? "▲" : "▼"} ${money(Math.abs(d))} ${
              d > 0 ? "más" : "menos"
            } que en ${prev}`,
          }
    );
  }
  return out;
}

/** Tooltip only: how a projected day is estimated. */
export const PROJECTION_METHOD =
  "Proyección: cada día que falta se estima con el promedio de ese día de la semana en las últimas 4 semanas";

export const NO_SUMMARY_TEXT =
  "Todavía no hay suficientes días para un resumen.";

/** One line of the «Resumen de Milton»: a template over computed numbers. */
export function findingText(
  f: MiltonFinding,
  m: RentabilidadMonth,
  money: Money
): string {
  switch (f.kind) {
    case "coverage":
      return "Tu ganancia puede ser menor: faltan recetas o precios en algunos platos.";
    case "cost_share_change": {
      const { now, before } = f.amounts;
      return `Comida y bebida ${now > before ? "subió" : "bajó"} de ${before}% a ${now}% de tus ventas frente a ${monthNameEs(previousMonthStart(m.month))}.`;
    }
    case "days_below": {
      const { total, below, breakEven, weakestAvg } = f.amounts;
      const be = `${money(breakEven)}, tu punto de equilibrio${f.estimated ? " (estimado)" : ""}`;
      const head =
        below > 0
          ? `${below} de ${total} días vendiste menos de ${be}.`
          : `Ningún día vendiste menos de ${be}.`;
      return f.weekday !== undefined && weakestAvg !== undefined
        ? `${head} Los ${weekdayPlural(f.weekday)} son el día más flojo (${money(weakestAvg)} en promedio).`
        : head;
    }
    case "projection":
      return `Si sigues a este ritmo, cierras el mes con ${f.amounts.profit < 0 ? "pérdida" : "ganancia"}.`;
  }
}
