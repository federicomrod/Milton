"use client";
import React, { useEffect, useState } from "react";
import { miltonEventsAPI } from "@/lib/milton-events";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { ReportData } from "@/lib/report-data-service";

type DashboardViewProps = {
  data?: ReportData;
};

export default function DashboardView(
  { data }: DashboardViewProps = { data: undefined }
) {
  const [chartData, setChartData] = useState<any[]>([]);
  const [businessModel, setBusinessModel] = useState("");
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>(
    data?.selectedKpiIds ?? []
  );
  const [kpiData, setKpiData] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribe = miltonEventsAPI.subscribe(
      "dashboard.data.ready",
      (payload) => {
        setBusinessModel(payload.businessModel);
        setKpiData(payload.kpis || []);
        if (payload.kpis?.length > 0) {
          // Create chart data from historical KPI data
          const chartDataMap = new Map();
          const allPeriods = new Set<string>();

          // First pass: collect all periods from all KPIs
          payload.kpis.forEach((kpi: any) => {
            if (kpi.historicalData && Array.isArray(kpi.historicalData)) {
              kpi.historicalData.forEach((dataPoint: any) => {
                allPeriods.add(dataPoint.period);
              });
            }
          });

          // Initialize chart data for all periods
          allPeriods.forEach((period) => {
            chartDataMap.set(period, {
              label: period,
              revenue: 0,
              expenses: 0,
              net_income: 0,
              active_members: null,
              revenue_per_member: null,
              revenue_growth_rate: null,
              no_show_rate: null,
              utilization_rate: null,
              average_class_size: null,
              // E-Commerce KPIs
              cmam: null,
              cac: null,
              cac_payback: null,
              marketing_efficiency: null,
              product_profitability: null,
              growth_quality_score: null,
            });
          });

          // Second pass: fill in the actual data
          payload.kpis.forEach((kpi: any) => {
            if (kpi.historicalData && Array.isArray(kpi.historicalData)) {
              kpi.historicalData.forEach((dataPoint: any) => {
                const period = dataPoint.period;
                const chartPoint = chartDataMap.get(period);

                if (chartPoint) {
                  // Map KPI values to chart fields based on KPI ID
                  if (kpi.id === "5d7de7ca-9821-422e-a492-407b4d3f16c3") {
                    // Active Members
                    chartPoint.active_members = dataPoint.value;
                  } else if (
                    kpi.id === "be8c439e-6e06-4bae-b5bb-30535ffef17d"
                  ) {
                    // Revenue per Member
                    chartPoint.revenue_per_member = dataPoint.value;
                  } else if (
                    kpi.id === "b52b4415-9de4-4e05-8c57-c90e1b9ddd80"
                  ) {
                    // No Show Rate
                    chartPoint.no_show_rate = dataPoint.value;
                  } else if (
                    kpi.id === "1ef40bd2-611d-4a9d-a3e6-eff7f0438578"
                  ) {
                    // Utilization Rate
                    chartPoint.utilization_rate = dataPoint.value;
                  } else if (
                    kpi.id === "c66a6894-da48-4e0c-bfe0-b24d9133980a"
                  ) {
                    // Average Class Size
                    chartPoint.average_class_size = dataPoint.value;
                  } else if (kpi.name === "Revenue Growth Rate") {
                    // Revenue Growth Rate (month-over-month %)
                    chartPoint.revenue_growth_rate = dataPoint.value;
                  } else if (
                    kpi.name
                      ?.toLowerCase()
                      .includes("contribution margin after marketing") ||
                    kpi.name?.toLowerCase().includes("cmam")
                  ) {
                    chartPoint.cmam = dataPoint.value;
                  } else if (
                    kpi.name
                      ?.toLowerCase()
                      .includes("customer acquisition cost") &&
                    !kpi.name?.toLowerCase().includes("payback")
                  ) {
                    chartPoint.cac = dataPoint.value;
                  } else if (
                    kpi.name?.toLowerCase().includes("cac payback") ||
                    kpi.name?.toLowerCase().includes("payback period")
                  ) {
                    chartPoint.cac_payback = dataPoint.value;
                  } else if (
                    kpi.name?.toLowerCase().includes("marketing efficiency") ||
                    kpi.name?.toLowerCase().includes("roas")
                  ) {
                    chartPoint.marketing_efficiency = dataPoint.value;
                  } else if (
                    kpi.name?.toLowerCase().includes("product profitability") ||
                    kpi.name?.toLowerCase().includes("product margin")
                  ) {
                    chartPoint.product_profitability = dataPoint.value;
                  } else if (
                    kpi.name?.toLowerCase().includes("growth quality score") ||
                    kpi.name?.toLowerCase().includes("growth quality")
                  ) {
                    chartPoint.growth_quality_score = dataPoint.value;
                  } else {
                    // Traditional financial KPIs
                    chartPoint.revenue = kpi.revenue ?? 0;
                    chartPoint.expenses = kpi.expenses ?? 0;
                    chartPoint.net_income = kpi.net_income ?? kpi.value ?? 0;
                  }
                }
              });
            }
          });

          // Convert map to array and sort by period
          const normalized = Array.from(chartDataMap.values()).sort(
            (a, b) => new Date(a.label).getTime() - new Date(b.label).getTime()
          );

          setChartData(normalized);
        }
      }
    );
    return () => unsubscribe();
  }, []);

  // Build visible KPI IDs from selectedKpiIds state
  const coreKpiIds = ["revenue", "expenses", "net_income"];
  const mergedKpiIds = [
    ...coreKpiIds,
    ...selectedKpiIds.filter((id) => !coreKpiIds.includes(id)),
  ];
  const visibleKpiIds = mergedKpiIds.slice(0, 6);

  if (!chartData.length && visibleKpiIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-gray-500 text-sm h-full">
        <p>📊 No KPI data available yet for {businessModel || "this model"}.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Key Metrics Row */}
      {visibleKpiIds.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleKpiIds.map((kpiId) => {
            // Find the corresponding KPI data
            const kpiInfo = kpiData.find((kpi: any) => kpi.id === kpiId);
            const displayValue = kpiInfo?.currentValue;
            const kpiDefinition = kpiInfo?.definition;

            return (
              <div
                key={kpiId}
                className="rounded-xl border bg-white p-4 flex flex-col justify-between shadow-sm"
              >
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {kpiInfo?.name || kpiId.replace(/_/g, " ")}
                </div>
                <div className="mt-2 text-2xl font-semibold text-gray-800">
                  {displayValue !== null && displayValue !== undefined
                    ? kpiInfo?.format === "percentage" ||
                      kpiInfo?.name === "Revenue Growth Rate" ||
                      kpiInfo?.name
                        ?.toLowerCase()
                        .includes("contribution margin after marketing") ||
                      kpiInfo?.name?.toLowerCase().includes("cmam") ||
                      kpiInfo?.name
                        ?.toLowerCase()
                        .includes("product profitability")
                      ? `${Number(displayValue).toFixed(1)}%`
                      : (displayValue.toFixed?.(1) ?? displayValue)
                    : "—"}
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {kpiDefinition || "Data calculated from your business data"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KPI Trends Chart */}
      {chartData.length > 0 &&
        (() => {
          const hasRevenueGrowthRate = kpiData.some(
            (kpi: any) => kpi.name === "Revenue Growth Rate"
          );
          // Only use revenue_growth_rate from chart data for the growth Y-axis domain
          const growthValues = chartData
            .map((d: any) => {
              const v = d.revenue_growth_rate;
              if (v == null) return NaN;
              const n = typeof v === "number" ? v : Number(v);
              return Number.isFinite(n) ? n : NaN;
            })
            .filter((n: number) => !Number.isNaN(n));
          const dataMin =
            growthValues.length > 0 ? Math.min(...growthValues) : 0;
          const dataMax =
            growthValues.length > 0 ? Math.max(...growthValues) : 0;
          const domainMin = Math.min(0, dataMin);
          const domainMax = Math.max(0, dataMax);
          const range = domainMax - domainMin;
          const padding = Math.max(1, range * 0.1);
          // Domain: we want bottom = min, top = max (0% at axis, positive above, negative below).
          // Recharts right YAxis maps domain[0] to top and domain[1] to bottom, so pass [max, min].
          const minVal = range === 0 ? -10 : domainMin - padding;
          const maxVal = range === 0 ? 10 : domainMax + padding;
          const growthDomain: [number, number] = [maxVal, minVal];
          return (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">
                Key KPI Trends {businessModel && `(${businessModel})`}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ right: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  {hasRevenueGrowthRate && (
                    <YAxis
                      yAxisId="revenueGrowth"
                      orientation="right"
                      domain={growthDomain}
                      reversed={false}
                      tickFormatter={(v) => `${v}%`}
                      allowDataOverflow={true}
                    />
                  )}
                  <Tooltip />
                  {/* Show different lines for different KPI types - always show if KPI exists */}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.id === "5d7de7ca-9821-422e-a492-407b4d3f16c3"
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="active_members"
                      stroke="#3b82f6"
                      name="Active Members"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.id === "be8c439e-6e06-4bae-b5bb-30535ffef17d"
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="revenue_per_member"
                      stroke="#10b981"
                      name="Revenue per Member (€)"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.id === "b52b4415-9de4-4e05-8c57-c90e1b9ddd80"
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="no_show_rate"
                      stroke="#f59e0b"
                      name="No Show Rate (%)"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.id === "1ef40bd2-611d-4a9d-a3e6-eff7f0438578"
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="utilization_rate"
                      stroke="#8b5cf6"
                      name="Utilization Rate (%)"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.id === "c66a6894-da48-4e0c-bfe0-b24d9133980a"
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="average_class_size"
                      stroke="#ef4444"
                      name="Average Class Size"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) => kpi.name === "Revenue Growth Rate"
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="revenue_growth_rate"
                      stroke="#0d9488"
                      name="Revenue Growth Rate (%)"
                      connectNulls={false}
                      yAxisId="revenueGrowth"
                    />
                  )}
                  {/* E-Commerce KPIs */}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.name
                        ?.toLowerCase()
                        .includes("contribution margin after marketing") ||
                      kpi.name?.toLowerCase().includes("cmam")
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="cmam"
                      stroke="#059669"
                      name="CMAM (%)"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.name
                        ?.toLowerCase()
                        .includes("customer acquisition cost") &&
                      !kpi.name?.toLowerCase().includes("payback")
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="cac"
                      stroke="#dc2626"
                      name="CAC"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.name?.toLowerCase().includes("cac payback") ||
                      kpi.name?.toLowerCase().includes("payback period")
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="cac_payback"
                      stroke="#ea580c"
                      name="CAC Payback (months)"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.name
                        ?.toLowerCase()
                        .includes("marketing efficiency") ||
                      kpi.name?.toLowerCase().includes("roas")
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="marketing_efficiency"
                      stroke="#7c3aed"
                      name="Marketing Efficiency (ROAS)"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.name
                        ?.toLowerCase()
                        .includes("product profitability") ||
                      kpi.name?.toLowerCase().includes("product margin")
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="product_profitability"
                      stroke="#2563eb"
                      name="Product Profitability (%)"
                      connectNulls={false}
                    />
                  )}
                  {kpiData.some(
                    (kpi: any) =>
                      kpi.name
                        ?.toLowerCase()
                        .includes("growth quality score") ||
                      kpi.name?.toLowerCase().includes("growth quality")
                  ) && (
                    <Line
                      type="monotone"
                      dataKey="growth_quality_score"
                      stroke="#0891b2"
                      name="Growth Quality Score"
                      connectNulls={false}
                    />
                  )}
                  {/* Fallback for traditional KPIs */}
                  {chartData.some((d: any) => d.net_income !== undefined) && (
                    <Line
                      type="monotone"
                      dataKey="net_income"
                      stroke="#6b7280"
                      name="Net Income"
                      connectNulls={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
    </div>
  );
}
