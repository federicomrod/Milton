// lib/pipeline-data-generators.ts
import type { Deal, PipelineMetrics } from "@/lib/types/pipeline";
import {
  normalizeStage,
  PHASE_ORDER,
  PHASE_WEIGHTS,
} from "@/lib/utils/pipeline-utils";

export function calculatePipelineMetrics(dealsData: Deal[]): PipelineMetrics {
  const allDeals = dealsData;

  // Pipeline by phase
  const phaseData = PHASE_ORDER.map((phase) => {
    const phaseDeals = allDeals.filter(
      (d) => normalizeStage(d.stage || "") === phase
    );

    return {
      phase,
      count: phaseDeals.length,
      value: phaseDeals.reduce((sum, d) => sum + Number(d.amount), 0),
      avgValue:
        phaseDeals.length > 0
          ? phaseDeals.reduce((sum, d) => sum + Number(d.amount), 0) /
            phaseDeals.length
          : 0,
    };
  });

  // Calculate conversion funnel (excluding 'No Deal')
  const activePhasesData = PHASE_ORDER.slice(0, -1); // Exclude 'No Deal'

  const funnelData = activePhasesData.map((phase) => {
    const phaseDeals = allDeals.filter(
      (d) => normalizeStage(d.stage || "") === phase
    );
    const count = phaseDeals.length;
    const totalDeals = allDeals.length;
    const value = phaseDeals.reduce((sum, d) => {
      const amount = Number(d.amount);
      return sum + (isNaN(amount) ? 0 : amount);
    }, 0);

    return {
      phase,
      count,
      cumulativeCount: count,
      value,
      percentage:
        totalDeals > 0 ? ((count / totalDeals) * 100).toFixed(1) : "0.0",
      avgDealSize: count > 0 ? Math.round(value / count) : 0,
    };
  });

  // Aggregate closed deals by product
  const productTotals = allDeals
    .filter((d) => {
      const normalizedStage = normalizeStage(d.stage || "");
      return normalizedStage === "Deal" && d.product;
    })
    .reduce<Record<string, number>>((acc, deal) => {
      const key = (deal.product || "Unspecified").trim() || "Unspecified";
      acc[key] = (acc[key] || 0) + Number(deal.amount || 0);
      return acc;
    }, {});

  const productData = Object.entries(productTotals)
    .map(([product, value]) => ({ product, value }))
    .sort((a, b) => b.value - a.value);

  // Calculate average sales cycle (for closed deals)
  function daysBetween(start?: string | null, end?: string | null) {
    if (!start || !end) return null;
    const s = new Date(start);
    const e = new Date(end);
    return (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24);
  }

  const closedDeals = dealsData.filter((d) => {
    const normalizedStage = normalizeStage(d.stage || "");
    return normalizedStage === "Deal" && d.close_date && d.created_date;
  });

  const salesCycles = closedDeals
    .map((d) => daysBetween(d.created_date, d.close_date))
    .filter((n): n is number => n != null && !Number.isNaN(n) && n > 0);

  const avgSalesCycle =
    salesCycles.length > 0
      ? Math.round(
          salesCycles.reduce((sum, days) => sum + days, 0) / salesCycles.length
        )
      : 0;

  // Pipeline forecast by closing date
  const pipelineForecast = (() => {
    // Get next 6 months
    const months = [];
    const today = new Date();
    for (let i = 0; i < 6; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
      months.push({
        month: date.toLocaleString("default", {
          month: "short",
          year: "numeric",
        }),
        yearMonth: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      });
    }

    // Group deals by month and phase
    const forecastData: Array<{
      month: string;
      [key: string]: string | number;
    }> = months.map(({ month, yearMonth }) => {
      const monthData: {
        month: string;
        [key: string]: string | number;
      } = { month };

      // Initialize all phases with 0
      PHASE_ORDER.slice(0, -2).forEach((phase) => {
        // Exclude 'Deal' and 'No Deal'
        monthData[phase] = 0;
        monthData[`${phase}_weighted`] = 0;
      });

      // Add deals to appropriate month and phase
      allDeals.forEach((deal) => {
        if (deal.close_date) {
          const dealDate = new Date(deal.close_date);
          const dealYearMonth = `${dealDate.getFullYear()}-${String(dealDate.getMonth() + 1).padStart(2, "0")}`;
          const normPhase = normalizeStage(deal.stage || "");
          if (
            dealYearMonth === yearMonth &&
            normPhase !== "No Deal" &&
            normPhase !== "Deal"
          ) {
            monthData[normPhase] =
              (Number(monthData[normPhase]) || 0) + Number(deal.amount);
            monthData[`${normPhase}_weighted`] =
              (Number(monthData[`${normPhase}_weighted`]) || 0) +
              Number(deal.amount) * (PHASE_WEIGHTS[normPhase] || 0);
          }
        }
      });

      // Calculate total for the month
      monthData.total = PHASE_ORDER.slice(0, -2).reduce(
        (sum, phase) => sum + (Number(monthData[phase]) || 0),
        0
      );
      monthData.total_weighted = PHASE_ORDER.slice(0, -2).reduce(
        (sum, phase) => sum + (Number(monthData[`${phase}_weighted`]) || 0),
        0
      );

      return monthData;
    });

    return forecastData;
  })();

  // Top 10 deals (closed deals only)
  // Filter for deals with stage "Deal" (normalized display name) or "deal" (lowercase)
  const topDeals = [...allDeals]
    .filter((d) => {
      const normalizedStage = normalizeStage(d.stage || "");
      const hasCloseDate = d.close_date && d.close_date.trim() !== "";
      const hasAmount = d.amount && Number(d.amount) > 0;
      return normalizedStage === "Deal" && hasCloseDate && hasAmount;
    })
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 10)
    .map((d) => ({
      name:
        d.deal_name ||
        (d.id ? `Deal ${String(d.id).slice(0, 8)}` : "Unnamed Deal"),
      client: d.client_name || d.company || "(No Client)",
      amount: Number(d.amount) || 0,
      phase: normalizeStage(d.stage || ""),
      id: d.id,
    }));

  return {
    pipelineByPhase: phaseData,
    funnelData: funnelData,
    dealsByProduct: productData,
    averageSalesCycle: avgSalesCycle,
    conversionRates: [],
    topDeals: topDeals,
    pipelineForecast: pipelineForecast,
  };
}
