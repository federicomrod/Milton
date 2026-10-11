// lib/restaurant/cockpit-insights.ts
//
// The backend picks and calculates at most 3 Cockpit insights.
// OpenAI only words them. If the model invents a number that is not in
// the facts, that insight falls back to the deterministic Spanish/English
// sentence. Metric names match the owners' email briefing.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { COSTS_HREF } from "@/lib/restaurant/navigation";
import type { CockpitPeriodSnapshot } from "@/lib/restaurant/cockpit-executive";

export const MAX_COCKPIT_INSIGHTS = 3;

export type CockpitInsightKind =
  | "data_health_costs"
  | "best_day"
  | "worst_day"
  | "channel_shift"
  | "ticket_change"
  | "sales_change";

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

const KIND_ORDER: CockpitInsightKind[] = [
  "data_health_costs",
  "best_day",
  "worst_day",
  "channel_shift",
  "ticket_change",
  "sales_change",
];

export function selectCockpitInsights(
  snapshot: CockpitPeriodSnapshot,
  lang: PreferredLanguage
): CockpitInsightFact[] {
  const candidates: CockpitInsightFact[] = [];

  if (snapshot.cost.coverage_pct <= 0) {
    candidates.push({
      id: "data_health_costs",
      kind: "data_health_costs",
      score: 1000,
      facts: {
        cost_coverage_pct: snapshot.cost.coverage_pct,
        net_sales: round2(snapshot.current.net_sales),
      },
      title: t(
        lang,
        "Recipe costs are still missing",
        "Todavía faltan los costos de recetas"
      ),
      body: t(
        lang,
        `Cost coverage is ${snapshot.cost.coverage_pct.toFixed(1)}% of net sales. Gross margin % and food cost % stay hidden until dishes have a cost.`,
        `La cobertura de costos es ${snapshot.cost.coverage_pct.toFixed(1)}% de las ventas netas. El margen bruto % y el % de costo de comida se ocultan hasta que los platillos tengan costo.`
      ),
      action: {
        label: t(lang, "Add costs", "Agregar costos"),
        href: `${COSTS_HREF}/upload`,
      },
    });
  }

  const daysWithSales = snapshot.daily.filter((d) => d.current_net > 0);
  if (daysWithSales.length >= 3) {
    const avg =
      daysWithSales.reduce((s, d) => s + d.current_net, 0) /
      daysWithSales.length;
    const best = daysWithSales.reduce((a, b) =>
      b.current_net > a.current_net ? b : a
    );
    const worst = daysWithSales.reduce((a, b) =>
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
        },
        title: t(
          lang,
          `${weekday} was the strongest day`,
          `${weekday} fue el mejor día`
        ),
        body: t(
          lang,
          `${weekday} did ${fmtMoney(best.current_net, snapshot.currency, lang)} in net sales, ${round1(bestDev * 100)}% above the daily average of ${fmtMoney(avg, snapshot.currency, lang)}.`,
          `${weekday} hizo ${fmtMoney(best.current_net, snapshot.currency, lang)} en ventas netas, ${round1(bestDev * 100)}% arriba del promedio diario de ${fmtMoney(avg, snapshot.currency, lang)}.`
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
        },
        title: t(
          lang,
          `${weekday} was the softest day`,
          `${weekday} fue el día más flojo`
        ),
        body: t(
          lang,
          `${weekday} did ${fmtMoney(worst.current_net, snapshot.currency, lang)} in net sales, ${Math.abs(round1(worstDev * 100))}% below the daily average of ${fmtMoney(avg, snapshot.currency, lang)}.`,
          `${weekday} hizo ${fmtMoney(worst.current_net, snapshot.currency, lang)} en ventas netas, ${Math.abs(round1(worstDev * 100))}% abajo del promedio diario de ${fmtMoney(avg, snapshot.currency, lang)}.`
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
      title: t(
        lang,
        `${shifted.label} share shifted`,
        `Cambió la participación de ${shifted.label}`
      ),
      body: t(
        lang,
        `${shifted.label} is ${shifted.share_pct.toFixed(1)}% of net sales (${up ? "+" : ""}${shifted.delta_pp.toFixed(1)} pp vs the previous period).`,
        `${shifted.label} es el ${shifted.share_pct.toFixed(1)}% de las ventas netas (${up ? "+" : ""}${shifted.delta_pp.toFixed(1)} pp vs el periodo anterior).`
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
      title: t(lang, "Average ticket moved", "El ticket promedio se movió"),
      body: t(
        lang,
        `Average ticket is ${fmtMoney(snapshot.current.avg_ticket, snapshot.currency, lang)} (${fmtSignedPct(ticketDelta)} vs the previous period) across ${snapshot.current.tickets} tickets.`,
        `El ticket promedio es ${fmtMoney(snapshot.current.avg_ticket, snapshot.currency, lang)} (${fmtSignedPct(ticketDelta)} vs el periodo anterior) en ${snapshot.current.tickets} tickets.`
      ),
    });
  }

  const salesDelta = deltaFrom(
    snapshot.current.net_sales,
    snapshot.previous.net_sales
  );
  if (salesDelta !== null && Math.abs(salesDelta) >= 5) {
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
      title: t(
        lang,
        "Net sales vs the previous period",
        "Ventas netas vs el periodo anterior"
      ),
      body: t(
        lang,
        `Net sales are ${fmtMoney(snapshot.current.net_sales, snapshot.currency, lang)} (${fmtSignedPct(salesDelta)} vs the previous period). Tips ${fmtMoney(snapshot.current.tips, snapshot.currency, lang)} stay on their own line.`,
        `Las ventas netas son ${fmtMoney(snapshot.current.net_sales, snapshot.currency, lang)} (${fmtSignedPct(salesDelta)} vs el periodo anterior). Las propinas ${fmtMoney(snapshot.current.tips, snapshot.currency, lang)} siguen en su propia línea.`
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
  return facts.slice(0, MAX_COCKPIT_INSIGHTS).map((fact) => ({
    id: fact.id,
    kind: fact.kind,
    title: fact.title,
    body: fact.body,
    action: fact.action,
    facts: fact.facts,
  }));
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
  const used = extractNumberTokens(text);
  return used.every((token) => allowed.has(token));
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
    const combined = `${match.title} ${match.body}`;
    if (!aiWordingIsGrounded(combined, base.facts)) {
      usedFallback = true;
      return base;
    }
    return {
      ...base,
      title: match.title.trim(),
      body: match.body.trim(),
    };
  });
  return { insights, usedFallback };
}

export function extractNumberTokens(text: string): string[] {
  const matches = text.match(/[-+]?\d[\d.,]*/g) ?? [];
  return matches.map(normalizeNumberToken).filter((token) => token.length > 0);
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
  return new Intl.DateTimeFormat(lang === "es" ? "es" : "en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

function fmtMoney(
  amount: number,
  currency: string,
  lang: PreferredLanguage
): string {
  const locale = lang === "es" ? "es-MX" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

function fmtSignedPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function deltaFrom(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
