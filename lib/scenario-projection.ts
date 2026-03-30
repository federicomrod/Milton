/**
 * Project baseline KPIs using scenario driver adjustments (for Impact Preview).
 */
import type { KPIMetrics } from "@/lib/report-data-service";
import type { DriverSection } from "@/lib/scenario-drivers";

function getDriverMap(
  sections: DriverSection[]
): Map<string, { value: number; baseline: number }> {
  const map = new Map<string, { value: number; baseline: number }>();
  for (const section of sections) {
    for (const d of section.drivers) {
      map.set(d.id, { value: d.value, baseline: d.baseline });
    }
  }
  return map;
}

function deltaPct(value: number, baseline: number): number {
  if (baseline === 0) return 0;
  return (value - baseline) / 100;
}

/**
 * Project revenue, expenses, net income, and cash runway from baseline KPIs
 * and current driver values. Uses universal and common driver ids across templates.
 */
export function projectKPIsFromDrivers(
  baseline: KPIMetrics,
  sections: DriverSection[]
): KPIMetrics {
  const d = getDriverMap(sections);

  // Revenue factor from % drivers (growth, price, expansion)
  let revenueFactor = 1;
  const revGrowth = d.get("revenue-growth");
  if (revGrowth) revenueFactor += deltaPct(revGrowth.value, revGrowth.baseline);
  const priceAdj = d.get("price-adjustment");
  if (priceAdj) revenueFactor += priceAdj.value / 100;
  const priceInc = d.get("price-increase");
  if (priceInc) revenueFactor += deltaPct(priceInc.value, priceInc.baseline);
  const expansion = d.get("expansion-revenue");
  if (expansion) revenueFactor += deltaPct(expansion.value, expansion.baseline);

  // Cost factor from cost-growth and optional variable-cost-ratio
  let costFactor = 1;
  const costGrowth = d.get("cost-growth");
  if (costGrowth) costFactor += deltaPct(costGrowth.value, costGrowth.baseline);
  const varCost = d.get("variable-cost-ratio");
  if (varCost && varCost.baseline > 0) {
    costFactor *= varCost.value / varCost.baseline;
  }

  // Optional: one-off cash adjustment
  let oneOff = 0;
  const oneOffDriver = d.get("one-off-adjustment");
  if (oneOffDriver) oneOff = oneOffDriver.value;

  const projectedRevenue = Math.max(0, baseline.revenue * revenueFactor);
  const projectedExpenses = Math.max(0, baseline.expenses * costFactor);
  const projectedNetIncome = projectedRevenue - projectedExpenses + oneOff;

  // Runway = current cash / monthly net burn. Net burn = expenses - revenue (positive = cash drain).
  const baselineNetCash =
    baseline.cashRunway > 0 && baseline.burnRate > 0
      ? baseline.cashRunway * baseline.burnRate
      : 0;
  const projectedNetBurn = Math.max(0, projectedExpenses - projectedRevenue);
  const RUNWAY_MAX_MONTHS = 120;
  const RUNWAY_MIN_NET_BURN = 1; // treat net burn < $1/month as effectively infinite
  let projectedRunway: number;
  if (projectedNetBurn <= 0 || projectedNetBurn < RUNWAY_MIN_NET_BURN) {
    projectedRunway =
      baselineNetCash > 0 ? RUNWAY_MAX_MONTHS : baseline.cashRunway;
  } else if (baselineNetCash <= 0) {
    projectedRunway = baseline.cashRunway;
  } else {
    const raw = baselineNetCash / projectedNetBurn;
    const months =
      Number.isFinite(raw) && raw > 0
        ? Math.min(RUNWAY_MAX_MONTHS, Math.max(1, Math.round(raw)))
        : baseline.cashRunway;
    projectedRunway = Number.isFinite(months) ? months : RUNWAY_MAX_MONTHS;
  }

  const projectedBurnRate =
    baseline.expenses > 0
      ? (baseline.burnRate * projectedExpenses) / baseline.expenses
      : baseline.burnRate;

  return {
    revenue: projectedRevenue,
    expenses: projectedExpenses,
    netIncome: projectedNetIncome,
    burnRate: projectedBurnRate,
    cashRunway: projectedRunway,
    pipelineValue: baseline.pipelineValue,
    openDeals: baseline.openDeals,
  };
}
