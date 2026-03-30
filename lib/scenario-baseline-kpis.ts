/**
 * Helpers to convert report-data KPIs into Scenario Planner display shape.
 */
import type { KPIMetrics } from "@/lib/report-data-service";

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

/** Format for Impact Preview: value + delta vs baseline */
export interface ProjectedKPIFormatted {
  label: string;
  value: string;
  delta: string;
  deltaPercentage: string;
  isPositive: boolean;
}

/**
 * Format baseline vs projected KPIs for Impact Preview (with deltas).
 */
export function formatProjectedKPIs(
  baseline: KPIMetrics,
  projected: KPIMetrics
): ProjectedKPIFormatted[] {
  const fmt = (v: number) =>
    v >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000
        ? `$${(v / 1_000).toFixed(1)}K`
        : `$${Math.round(v)}`;
  const deltaRev = projected.revenue - baseline.revenue;
  const deltaExp = projected.expenses - baseline.expenses;
  const deltaNI = projected.netIncome - baseline.netIncome;
  const deltaRunway = projected.cashRunway - baseline.cashRunway;
  const pct = (delta: number, base: number) =>
    base !== 0
      ? `${delta >= 0 ? "+" : ""}${((delta / base) * 100).toFixed(1)}%`
      : "—";
  return [
    {
      label: "Revenue",
      value: fmt(projected.revenue),
      delta: `${deltaRev >= 0 ? "+" : ""}${fmt(deltaRev)}`,
      deltaPercentage: pct(deltaRev, baseline.revenue),
      isPositive: deltaRev >= 0,
    },
    {
      label: "Costs",
      value: fmt(projected.expenses),
      delta: `${deltaExp >= 0 ? "+" : ""}${fmt(deltaExp)}`,
      deltaPercentage: pct(deltaExp, baseline.expenses),
      isPositive: deltaExp <= 0,
    },
    {
      label: "Net Income",
      value: fmt(projected.netIncome),
      delta: `${deltaNI >= 0 ? "+" : ""}${fmt(deltaNI)}`,
      deltaPercentage: pct(deltaNI, baseline.netIncome),
      isPositive: deltaNI >= 0,
    },
    {
      label: "Cash Runway",
      value: `${projected.cashRunway} months`,
      delta: `${deltaRunway >= 0 ? "+" : ""}${deltaRunway} months`,
      deltaPercentage:
        baseline.cashRunway !== 0
          ? `${deltaRunway >= 0 ? "+" : ""}${((deltaRunway / baseline.cashRunway) * 100).toFixed(1)}%`
          : "—",
      isPositive: deltaRunway >= 0,
    },
  ];
}

export interface ScenarioKPIFromBaseline {
  title: string;
  value: string;
  delta: string;
  deltaPercent: string;
  isPositive: boolean;
}

/** Convert Impact Preview projected KPIs to the snapshot shape saved with the scenario (for results page). */
export function projectedKPIsToSnapshotKpis(
  formatted: ProjectedKPIFormatted[]
): Array<{
  title: string;
  value: string;
  delta: string;
  deltaPercent: string;
  isPositive: boolean;
}> {
  return formatted.map((k) => ({
    title: k.label,
    value: k.value,
    delta: k.delta,
    deltaPercent: k.deltaPercentage,
    isPositive: k.isPositive,
  }));
}

/**
 * Convert baseline KPIs from GET /api/report-data into the shape expected by ScenarioKPISummary.
 * Delta/deltaPercent show "—" when only baseline is available (no scenario comparison yet).
 */
export function baselineKpisToScenarioKpis(
  kpis: KPIMetrics
): ScenarioKPIFromBaseline[] {
  return [
    {
      title: "Revenue",
      value: formatCurrency(kpis.revenue),
      delta: "—",
      deltaPercent: "—",
      isPositive: true,
    },
    {
      title: "Costs",
      value: formatCurrency(kpis.expenses),
      delta: "—",
      deltaPercent: "—",
      isPositive: false,
    },
    {
      title: "Net Income",
      value: formatCurrency(kpis.netIncome),
      delta: "—",
      deltaPercent: "—",
      isPositive: kpis.netIncome >= 0,
    },
    {
      title: "Cash Runway",
      value: `${kpis.cashRunway} months`,
      delta: "—",
      deltaPercent: "—",
      isPositive: true,
    },
  ];
}
