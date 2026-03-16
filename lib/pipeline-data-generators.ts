// lib/pipeline-data-generators.ts
import type { Deal, PipelineMetrics } from "@/lib/types/pipeline";
import {
  normalizeStage,
  PHASE_ORDER,
  PHASE_WEIGHTS,
} from "@/lib/utils/pipeline-utils";

export function calculatePipelineMetrics(dealsData: Deal[]): PipelineMetrics {
  const allDeals = dealsData;

  const getStage = (d: Deal) => (d.stage ?? d.phase ?? "").trim();
  const getCloseDate = (d: Deal) => d.close_date ?? d.closing_date ?? "";

  // Active deals (exclude closed won and closed lost)
  const activeDealsList = allDeals.filter((d) => {
    const norm = normalizeStage(getStage(d));
    return norm !== "No Deal" && norm !== "Deal";
  });
  const totalPipelineValue = activeDealsList.reduce(
    (sum, d) => sum + Number(d.amount || 0),
    0
  );
  const weightedPipelineValue = activeDealsList.reduce(
    (sum, d) =>
      sum +
      Number(d.amount || 0) * (PHASE_WEIGHTS[normalizeStage(getStage(d))] ?? 0),
    0
  );
  const activeCustomers = new Set(
    activeDealsList
      .map((d) =>
        String(d.client_name ?? (d as any).company ?? "")
          .trim()
          .toLowerCase()
      )
      .filter((s) => s !== "")
  ).size;
  const closedWonList = allDeals.filter((d) => {
    const norm = normalizeStage(getStage(d));
    return norm === "Deal" && getCloseDate(d);
  });
  const closedLostList = allDeals.filter((d) => {
    const norm = normalizeStage(getStage(d));
    return norm === "No Deal" && getCloseDate(d);
  });
  const totalClosed = closedWonList.length + closedLostList.length;
  const dealConversionRate =
    totalClosed === 0
      ? 0
      : Math.round((closedWonList.length / totalClosed) * 1000) / 10;
  const clientValueByClient = activeDealsList.reduce<Record<string, number>>(
    (acc, d) => {
      const key =
        String(d.client_name ?? (d as any).company ?? "").trim() || "Unknown";
      acc[key] = (acc[key] || 0) + Number(d.amount || 0);
      return acc;
    },
    {}
  );
  const sortedClients = Object.entries(clientValueByClient).sort(
    (a, b) => b[1] - a[1]
  );
  const topClientValue = sortedClients[0]?.[1] ?? 0;
  const clientConcentrationPercent =
    totalPipelineValue > 0 && topClientValue > 0
      ? Math.round((topClientValue / totalPipelineValue) * 1000) / 10
      : 0;

  // Pipeline by phase
  const phaseData = PHASE_ORDER.map((phase) => {
    const phaseDeals = allDeals.filter(
      (d) => normalizeStage(getStage(d)) === phase
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
      (d) => normalizeStage(getStage(d)) === phase
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
      const normalizedStage = normalizeStage(getStage(d));
      return normalizedStage === "Deal" && (d.product ?? (d as any).Product);
    })
    .reduce<Record<string, number>>((acc, deal) => {
      const product = deal.product ?? (deal as any).Product ?? "Unspecified";
      const key = String(product).trim() || "Unspecified";
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
    const normalizedStage = normalizeStage(getStage(d));
    const closeDate = getCloseDate(d);
    const createdDate = d.created_date ?? (d as any).first_appointment ?? "";
    return normalizedStage === "Deal" && closeDate && createdDate;
  });

  const salesCycles = closedDeals
    .map((d) =>
      daysBetween(
        d.created_date ?? (d as any).first_appointment,
        d.close_date ?? d.closing_date
      )
    )
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
        const closeDate = getCloseDate(deal);
        if (closeDate) {
          const dealDate = new Date(closeDate);
          const dealYearMonth = `${dealDate.getFullYear()}-${String(dealDate.getMonth() + 1).padStart(2, "0")}`;
          const normPhase = normalizeStage(getStage(deal));
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
  const topDeals = [...allDeals]
    .filter((d) => {
      const normalizedStage = normalizeStage(getStage(d));
      const closeDate = getCloseDate(d);
      const hasCloseDate = closeDate && String(closeDate).trim() !== "";
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
      phase: normalizeStage(getStage(d)),
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
    totalPipelineValue,
    weightedPipelineValue,
    activeCustomers,
    dealConversionRate,
    clientConcentrationPercent,
  };
}
