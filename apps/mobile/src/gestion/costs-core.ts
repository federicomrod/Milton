// What Costos and Rentabilidad say when a figure is missing, and the «Calidad
// de datos» rows. Pure and tested: it only turns the server's `reasons` (and
// numbers it already sent) into sentences. It never computes a money figure,
// and a missing value is never shown as «—» or 0: it says why and what to do.

import { fmt, type Language } from "../i18n/strings";
import { formatFraction, monthName } from "./format";
import type { GestionStrings } from "./strings";
import type { DataReasons } from "./types";

/** A card's content: the figure, or the reason it is missing and the next step. */
export interface FigureView {
  value: number | null;
  /** Small line under a figure (how much of the sales it covers). */
  note: string | null;
  reason: string | null;
  next: string | null;
}

const list = (items: string[]) => items.join(", ");

function fixedCategoryNames(missing: string[], g: GestionStrings): string[] {
  return missing.map(
    (c) => g.costs.fixedCats[c as keyof typeof g.costs.fixedCats] ?? c
  );
}

/** «N sin receta, M con receta en borrador, …» — only what is non-zero. */
export function uncostedParts(
  r: DataReasons["foodCost"]["uncoveredByReason"],
  g: GestionStrings
): string[] {
  const out: string[] = [];
  if (r.sinReceta > 0)
    out.push(fmt(g.costs.missingRecipes, { n: r.sinReceta }));
  if (r.borrador > 0) out.push(fmt(g.costs.missingDraft, { n: r.borrador }));
  if (r.sinPrecio > 0) out.push(fmt(g.costs.missingPrices, { n: r.sinPrecio }));
  return out;
}

/** «Costo de ventas»: the percentage, or why there is none yet. */
export function foodCostView(args: {
  pct: number | null;
  reasons: DataReasons | undefined;
  month: string;
  g: GestionStrings;
  lang: Language;
}): FigureView {
  const { pct, reasons, month, g, lang } = args;
  const m = monthName(month, lang);
  if (pct !== null) {
    const cov = reasons?.foodCost.coveredPct;
    return {
      value: pct,
      note:
        typeof cov === "number" && cov < 1
          ? fmt(g.costs.coveredNote, { pct: formatFraction(cov, lang) })
          : null,
      reason: null,
      next: null,
    };
  }
  const f = reasons?.foodCost;
  if (f?.status === "no_costed_dishes") {
    const parts = uncostedParts(f.uncoveredByReason, g);
    return {
      value: null,
      note: null,
      reason:
        parts.length > 0
          ? `${g.costs.noCostedDishes} ${list(parts)}.`
          : g.costs.noCostedDishes,
      next: g.costs.noCostedNext,
    };
  }
  if (f?.status === "no_sales" || reasons?.hasSales === false) {
    return {
      value: null,
      note: null,
      reason: fmt(g.costs.reasonNoSales, { month: m }),
      next: g.costs.reasonNoSalesNext,
    };
  }
  // An older server that does not say why.
  return { value: null, note: null, reason: g.costs.kpisNoData, next: null };
}

/** «Costos fijos del mes»: the total, or what is missing and where to add it. */
export function fixedCostView(args: {
  total: number | null;
  reasons: DataReasons | undefined;
  month: string;
  g: GestionStrings;
  lang: Language;
}): FigureView {
  const { total, reasons, month, g, lang } = args;
  const m = monthName(month, lang);
  if (total !== null) {
    return { value: total, note: null, reason: null, next: null };
  }
  const f = reasons?.fixed;
  if (f && !f.loaded) {
    return {
      value: null,
      note: null,
      reason: fmt(g.costs.fixedNone, { month: m }),
      next: g.costs.fixedNoneNext,
    };
  }
  if (f && f.missing.length > 0) {
    return {
      value: null,
      note: null,
      reason: fmt(g.costs.fixedPartial, {
        month: m,
        list: list(fixedCategoryNames(f.missing, g)),
      }),
      next: g.costs.fixedPartialNext,
    };
  }
  return { value: null, note: null, reason: g.costs.kpisNoData, next: null };
}

export interface QualityRow {
  key: "uncosted" | "covered" | "fixed" | "invoices";
  label: string;
  value: string;
  /** ok = nothing to do, warn = something to complete. */
  tone: "ok" | "warn";
  /** 0–1, for a bar (covered share). */
  ratio?: number;
}

/**
 * The «Calidad de datos» rows. Only what the server could compute: the dish
 * rows need sales and dishes, so without them they are left out (and the card
 * says when they will appear). Returns null when nothing at all is known.
 */
export function qualityRows(args: {
  reasons: DataReasons | undefined;
  pendingInvoices: number | null;
  month: string;
  g: GestionStrings;
  lang: Language;
}): { rows: QualityRow[]; note: string | null } | null {
  const { reasons, pendingInvoices, month, g, lang } = args;
  const rows: QualityRow[] = [];
  let note: string | null = null;
  if (reasons) {
    const f = reasons.foodCost;
    if (reasons.hasSales && f.coveredPct !== null && f.uncoveredPct !== null) {
      rows.push({
        key: "uncosted",
        label: g.costs.qualityNoCost,
        value:
          f.uncoveredDishes > 0
            ? fmt(g.costs.qualityNoCostValue, {
                n: f.uncoveredDishes,
                pct: formatFraction(f.uncoveredPct, lang),
              })
            : g.costs.qualityAllCosted,
        tone: f.uncoveredDishes > 0 ? "warn" : "ok",
      });
      rows.push({
        key: "covered",
        label: g.costs.qualityCovered,
        value: formatFraction(f.coveredPct, lang),
        tone: f.coveredPct >= 1 ? "ok" : "warn",
        ratio: f.coveredPct,
      });
    } else {
      note = g.costs.qualityNoSales;
    }
    const fx = reasons.fixed;
    rows.push({
      key: "fixed",
      label: fmt(g.costs.qualityFixed, { month: monthName(month, lang) }),
      value: !fx.loaded
        ? g.costs.qualityFixedNone
        : fx.complete
          ? g.costs.qualityFixedLoaded
          : fmt(g.costs.qualityFixedPartial, {
              list: list(fixedCategoryNames(fx.missing, g)),
            }),
      tone: fx.complete ? "ok" : "warn",
    });
  }
  if (pendingInvoices !== null) {
    rows.push({
      key: "invoices",
      label: g.costs.qualityInvoices,
      value:
        pendingInvoices > 0
          ? fmt(g.costs.qualityInvoicesN, { n: pendingInvoices })
          : g.costs.qualityInvoicesNone,
      tone: pendingInvoices > 0 ? "warn" : "ok",
    });
  }
  return rows.length > 0 ? { rows, note } : null;
}

/**
 * «Qué falta para {mes}»: one sentence (with its next step) per missing input
 * of a month that cannot show a profit yet. Empty when the server did not say.
 */
export function missingForMonth(args: {
  reasons: DataReasons | undefined;
  month: string;
  g: GestionStrings;
  lang: Language;
}): string[] {
  const { reasons, month, g, lang } = args;
  if (!reasons) return [];
  const m = monthName(month, lang);
  if (!reasons.hasSales) {
    return [
      `${fmt(g.costs.reasonNoSales, { month: m })} ${g.costs.reasonNoSalesNext}`,
    ];
  }
  const out: string[] = [];
  const dish = foodCostView({
    pct: reasons.foodCost.pct,
    reasons,
    month,
    g,
    lang,
  });
  if (dish.value === null && dish.reason)
    out.push([dish.reason, dish.next].filter(Boolean).join(" "));
  const fixed = fixedCostView({
    total: reasons.fixed.complete ? 0 : null,
    reasons,
    month,
    g,
    lang,
  });
  if (fixed.value === null && fixed.reason)
    out.push([fixed.reason, fixed.next].filter(Boolean).join(" "));
  return out;
}
