// lib/restaurant/cockpit-insight.ts
//
// The Cockpit «✦ Milton» box: up to 3 short lines built from what the Cockpit
// already loaded (the daily bars). Deterministic, no query, no AI call. A line
// never restates a number the KPI chips or tiles already show (no period
// totals, no vs-objetivo chip values): it says what they do not — which weekday
// is weakest against the objetivo, how many days fell below it, and which
// weekday sells most. No cause is claimed.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { weekdayIndex } from "@/lib/restaurant/cockpit-math";
import type { CockpitView } from "@/lib/restaurant/cockpit-v2";

export const NO_COCKPIT_SUMMARY =
  "Todavía no hay suficientes días para un resumen.";
export const NO_TARGETS_SUMMARY =
  "Define tus objetivos y Milton te dice cómo vas contra ellos.";

type InsightView = Pick<CockpitView, "bars" | "aboveDays" | "belowDays">;

function listNames(names: string[], and: string): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

/** 1 to 3 lines, or the one fallback line when there is not enough to say. */
export function cockpitSummaryLines(
  view: InsightView,
  hasTargets: boolean,
  lang: PreferredLanguage = "es"
): string[] {
  const d = getDictionary(lang).cockpit.insight;
  const lines: string[] = [];

  // Weekdays whose days with a target fall well short of it.
  const delta = new Map<number, number[]>();
  const sales = new Map<number, number[]>();
  for (const b of view.bars) {
    const wd = weekdayIndex(b.date);
    sales.set(wd, [...(sales.get(wd) ?? []), b.sales]);
    if (b.deltaPct !== null)
      delta.set(wd, [...(delta.get(wd) ?? []), b.deltaPct]);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const weak = [...delta.entries()]
    .map(([wd, v]) => ({ wd, avg: avg(v), n: v.length }))
    .filter((x) => x.n >= 2 && x.avg <= -10)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 2);
  if (weak.length > 0)
    lines.push(
      fmt(d.weakest, {
        days: listNames(
          weak.map((w) => d.weekdaysPlural[w.wd]),
          d.and
        ),
        pct: Math.round(weak[0].avg),
      })
    );

  // How many days with a target ended below it.
  const withTarget = view.aboveDays + view.belowDays;
  if (withTarget >= 3)
    lines.push(
      view.belowDays > 0
        ? fmt(d.below, { below: view.belowDays, total: withTarget })
        : d.noneBelow
    );

  // The weekday that sells most, once at least two weekdays repeat.
  const strong = [...sales.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([wd, v]) => ({ wd, avg: avg(v) }))
    .sort((a, b) => b.avg - a.avg);
  if (strong.length >= 2 && strong[0].avg > strong[1].avg)
    lines.push(fmt(d.strongest, { day: d.weekdaysPlural[strong[0].wd] }));

  if (lines.length === 0) return [hasTargets ? d.notEnoughDays : d.noTargets];
  return lines.slice(0, 3);
}
