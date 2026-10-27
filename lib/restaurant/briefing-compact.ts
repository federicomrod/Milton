// lib/restaurant/briefing-compact.ts
//
// The Ask Milton side panel shows the executive briefing collapsed, as one
// line made ONLY from numbers the briefing context already computed
// (sales_periods: yesterday vs the same weekday a week earlier, last 7 days
// vs the 7 before). Nothing here estimates or invents a figure: a missing
// period is simply left out of the line.
//
// Pure and client-safe (no server imports).

import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";
import type { PreferredLanguage } from "@/lib/restaurant/language";

/** The slice of BriefingSalesPeriods the API sends to the panel. */
export interface BriefingCompactPeriods {
  /** YYYY-MM-DD of the previous local day. */
  yesterday_date: string;
  yesterday: { sales: number | null; delta_pct: number | null };
  last_7_days: { sales: number | null; delta_pct: number | null };
}

const WEEKDAY_ABBR: Record<PreferredLanguage, readonly string[]> = {
  es: ["dom.", "lun.", "mar.", "mié.", "jue.", "vie.", "sáb."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

function weekdayOf(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  ).getUTCDay();
}

function pct(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

/**
 * «Ayer $1,745 (+22% vs. lun. pasado) · 7 días $20,133 (+33%)».
 * Returns null when neither period has sales, so the caller can fall back
 * to text the briefing already showed instead of a made-up line.
 */
export function compactBriefingLine(
  periods: BriefingCompactPeriods | null | undefined,
  currency: string,
  lang: PreferredLanguage
): string | null {
  if (!periods) return null;
  const money = (n: number) => formatMoneyEs(n, currency, { decimals: 0 });
  const parts: string[] = [];

  const y = periods.yesterday;
  if (y && y.sales !== null && Number.isFinite(y.sales)) {
    let s = `${lang === "es" ? "Ayer" : "Yesterday"} ${money(y.sales)}`;
    const wd = weekdayOf(periods.yesterday_date);
    if (y.delta_pct !== null && Number.isFinite(y.delta_pct) && wd !== null) {
      const day = WEEKDAY_ABBR[lang][wd];
      s +=
        lang === "es"
          ? ` (${pct(y.delta_pct)} vs. ${day} pasado)`
          : ` (${pct(y.delta_pct)} vs. last ${day})`;
    }
    parts.push(s);
  }

  const w = periods.last_7_days;
  if (w && w.sales !== null && Number.isFinite(w.sales)) {
    let s = `${lang === "es" ? "7 días" : "7 days"} ${money(w.sales)}`;
    if (w.delta_pct !== null && Number.isFinite(w.delta_pct)) {
      s += ` (${pct(w.delta_pct)})`;
    }
    parts.push(s);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Generic advice («Aumentar la eficiencia en la gestión de costos») names
 * nothing the owner can act on. An item is kept only when it carries a
 * number or names something (a capitalised word after the first one: a
 * dish, a supplier, a screen).
 */
export function isSpecificBriefingItem(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  if (/\d/.test(s)) return true;
  const rest = s.replace(/^[^\p{L}]*\p{L}+/u, "");
  return /(^|[\s(«"'“/])\p{Lu}/u.test(rest);
}

// ---------------------------------------------------------------------------
// Per-session collapse state (sessionStorage). Collapsed by default; every
// message the owner sends collapses it again (and a reload keeps it so).
// «Ver más» still opens it on demand.
// ---------------------------------------------------------------------------

export const BRIEFING_EXPANDED_KEY = "milton.askMilton.briefingExpanded";
export const ASK_SENT_KEY = "milton.askMilton.sentThisSession";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readBriefingExpanded(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(BRIEFING_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBriefingExpanded(
  storage: StorageLike | null,
  expanded: boolean
): void {
  if (!storage) return;
  try {
    storage.setItem(BRIEFING_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    /* storage full or blocked: the state just isn't remembered */
  }
}

export function markAskSent(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.setItem(ASK_SENT_KEY, "1");
    storage.setItem(BRIEFING_EXPANDED_KEY, "0");
  } catch {
    /* ignore */
  }
}
