"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { UploadInvitation } from "@/components/dashboard/upload-invitation";
import { KpiSelector } from "@/components/dashboard/kpi-selector";
import { KpisGrid } from "@/components/dashboard/kpis-grid";
import { MetricsGrid } from "@/components/dashboard/metrics-grid";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { FinancialCharts } from "@/components/dashboard/financial-charts";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import type { DatabaseKpi } from "@/lib/types/kpi";

// Helper component for locked/missing data placeholders
const LockedPlaceholder = ({ message }: { message: string }) => (
  <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
    💡 {message}
  </div>
);

type DataStatus = {
  ok?: boolean;
  bank?: boolean;
  crm?: boolean;
  budget?: boolean;
  hasModelData?: boolean;
} | null;

export default function DashboardPage() {
  const [dataStatus, setDataStatus] = useState<DataStatus>(null);

  // KPI state
  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>([]);
  const [selectedKpis, setSelectedKpis] = useState<DatabaseKpi[]>([]);
  const [recommendedKpis, setRecommendedKpis] = useState<DatabaseKpi[]>([]);
  const [additionalKpis, setAdditionalKpis] = useState<DatabaseKpi[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const dataLoadedRef = useRef(false);
  const kpisLoadedRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [period, setPeriod] = useState<"month" | "year" | "ytd" | "custom">(
    "month"
  );
  const [customDateRange, setCustomDateRange] = useState<{
    from: string;
    to: string;
  }>({
    from: new Date(new Date().setMonth(new Date().getMonth() - 1))
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  // Helper function to check if all data is ready
  const checkIfDataReady = () => {
    if (dataLoadedRef.current && kpisLoadedRef.current) {
      // Add a small delay to allow child components (MetricsGrid, FinancialCharts) to start loading
      setTimeout(() => {
        setIsLoading(false);
      }, 500);
    }
  };

  // Fetch company business model and data status
  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          // Fetch data status
          const statusRes = await fetch("/api/data/status");
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setDataStatus(statusData);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        // Mark data as loaded
        dataLoadedRef.current = true;
        // Check if we can hide the loader
        checkIfDataReady();
      }
    };

    fetchData();
  }, []);

  // Load KPI selector pool (recommended + additional) and selected IDs from kpi-preferences.
  // Load displayed selected KPIs from /api/kpis/selected (source of truth: business_models.selected_kpi_ids).
  // No caching: users frequently save new KPIs.
  useEffect(() => {
    const loadKpis = async () => {
      try {
        const [prefRes, selectedRes] = await Promise.all([
          fetch("/api/onboarding/kpi-preferences", {
            cache: "no-store",
            credentials: "include",
          }),
          fetch("/api/kpis/selected", {
            cache: "no-store",
            credentials: "include",
          }),
        ]);

        if (prefRes.ok) {
          const data = await prefRes.json();
          const kpiIds = (data.selectedKpiIds ?? []) as string[];
          const recommended = (data.recommendedKpis ?? []) as DatabaseKpi[];
          const additional = (data.additionalKpis ?? []) as DatabaseKpi[];
          setSelectedKpiIds(kpiIds);
          setRecommendedKpis(recommended);
          setAdditionalKpis(additional);
        }

        if (selectedRes.ok) {
          const json = await selectedRes.json();
          const list = Array.isArray(json?.selectedKpis)
            ? json.selectedKpis
            : [];
          setSelectedKpis(list);
        }
      } catch (err) {
        console.error("[DashboardPage] Error loading KPIs:", err);
      } finally {
        kpisLoadedRef.current = true;
        checkIfDataReady();
      }
    };

    loadKpis();
  }, []);

  // Set timeout to hide loader after 10 seconds
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      setIsLoading(false);
    }, 10000);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleKpisChange = (newSelectedKpis: string[]) => {
    setSelectedKpiIds(newSelectedKpis);
    // Refetch displayed KPIs from API (source of truth) so all saved IDs show, not just those in the template pool
    fetch("/api/kpis/selected", { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : { selectedKpis: [] }))
      .then((json) =>
        setSelectedKpis(
          Array.isArray(json?.selectedKpis) ? json.selectedKpis : []
        )
      )
      .catch(() => {});
  };

  return (
    <>
      {/* Loading Overlay - Fixed to viewport */}
      {isLoading && (
        <div className="fixed inset-0 bg-background/90 backdrop-blur-md z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
            <p className="text-lg font-medium text-foreground">
              Loading dashboard...
            </p>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Show business type badge */}
          {/* {companyBusinessType && (
            <div className="mb-6 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Business Type:
              </span>
              <span className="text-sm font-medium text-primary">
                {companyBusinessType}
              </span>
            </div>
          )} */}

          {/* Upload Invitation Section - Show if user hasn't uploaded data */}
          {dataStatus && !dataStatus.hasModelData && (
            <div className="mb-8">
              <UploadInvitation />
            </div>
          )}

          {/* KPIs Section - Unified Metrics and KPIs */}
          <div className="space-y-6">
            {/* Key Metrics Section */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Key Metrics</h2>
              <DateRangePicker
                period={period}
                customDateRange={customDateRange}
                onPeriodChange={(value) => setPeriod(value)}
                onCustomDateRangeChange={(range) => setCustomDateRange(range)}
              />
            </div>

            {dataStatus?.bank ||
            dataStatus?.crm ||
            dataStatus?.budget ||
            dataStatus?.hasModelData ? (
              <>
                <MetricsGrid
                  period={period}
                  customDateRange={customDateRange}
                />
                <div className="mt-8">
                  <DashboardInsights />
                </div>
                <div className="space-y-4 mt-8">
                  <h2 className="text-lg font-semibold">Performance Charts</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FinancialCharts
                      type="mrr-vs-plan"
                      period={period}
                      customDateRange={customDateRange}
                    />
                    <FinancialCharts
                      type="burn-rate"
                      period={period}
                      customDateRange={customDateRange}
                    />
                  </div>
                </div>
              </>
            ) : (
              <LockedPlaceholder message="Upload your data in the 'Upload' section above to see your key metrics and performance charts." />
            )}

            {/* KPIs Section */}
            <div className="mt-8 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  Key Performance Indicators
                </h2>
                <KpiSelector
                  selectedKpiIds={selectedKpiIds}
                  onKpisChange={handleKpisChange}
                  recommendedKpis={recommendedKpis}
                  additionalKpis={additionalKpis}
                />
              </div>
              {dataStatus?.hasModelData ? (
                <KpisGrid selectedKpis={selectedKpis} />
              ) : (
                <LockedPlaceholder message="Upload your data in the 'Upload' section above to see your KPIs and metrics." />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
