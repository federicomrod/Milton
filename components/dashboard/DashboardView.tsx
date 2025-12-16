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
  { data }: DashboardViewProps = { data: undefined },
) {
  const [chartData, setChartData] = useState<any[]>([]);
  const [businessModel, setBusinessModel] = useState("");
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>(
    data?.selectedKpiIds ?? [],
  );

  useEffect(() => {
    const unsubscribe = miltonEventsAPI.subscribe(
      "dashboard.data.ready",
      (payload) => {
        console.log("[DashboardView] Received dashboard data:", payload);
        setBusinessModel(payload.businessModel);
        if (payload.kpis?.length > 0) {
          // Map KPI rows to chart data with real period labels
          const normalized = payload.kpis.map((kpi: any) => ({
            label: kpi.period ?? "Unknown period",
            revenue: kpi.revenue ?? 0,
            expenses: kpi.expenses ?? 0,
            net_income: kpi.net_income ?? kpi.value ?? 0,
          }));
          setChartData(normalized);
        }
      },
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
      {/* Header */}
      <h2 className="text-lg font-semibold">Key Metrics</h2>

      {/* Key Metrics Row */}
      {visibleKpiIds.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleKpiIds.map((kpiId) => (
            <div
              key={kpiId}
              className="rounded-xl border bg-white p-4 flex flex-col justify-between shadow-sm"
            >
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {kpiId.replace(/_/g, " ")}
              </div>
              <div className="mt-2 text-2xl font-semibold text-gray-800">—</div>
              <div className="mt-1 text-[11px] text-gray-400">
                No data yet – snapshots not implemented
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KPI Trends Chart */}
      {chartData.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">
            Key KPI Trends {businessModel && `(${businessModel})`}
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
