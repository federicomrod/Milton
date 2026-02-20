"use client";

import { useEffect, useState, useRef } from "react";
import { UploadInvitation } from "@/components/dashboard/upload-invitation";
import { KpiSelector } from "@/components/dashboard/kpi-selector";
import type { KpiDisplayMode } from "@/components/dashboard/kpi-selector";
import { KpisGrid } from "@/components/dashboard/kpis-grid";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { Loader2 } from "lucide-react";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import type { DatabaseKpi } from "@/lib/types/kpi";
import { useUser } from "@/lib/context/UserContext";

const DISPLAY_MODES_STORAGE_KEY = "kpi-display-modes";

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
  const { user } = useUser();

  const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>([]);
  const [selectedKpis, setSelectedKpis] = useState<DatabaseKpi[]>([]);
  const [recommendedKpis, setRecommendedKpis] = useState<DatabaseKpi[]>([]);
  const [additionalKpis, setAdditionalKpis] = useState<DatabaseKpi[]>([]);
  const [kpiDisplayModes, setKpiDisplayModes] = useState<
    Record<string, KpiDisplayMode>
  >({});

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

  // Load display modes from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISPLAY_MODES_STORAGE_KEY);
      if (stored) {
        setKpiDisplayModes(JSON.parse(stored));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const checkIfDataReady = () => {
    if (dataLoadedRef.current && kpisLoadedRef.current) {
      setTimeout(() => setIsLoading(false), 500);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (user) {
          const statusRes = await fetch("/api/data/status", {
            credentials: "include",
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            console.log("[BROWSER LOG] /api/data/status response:", statusData);
            setDataStatus(statusData);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        dataLoadedRef.current = true;
        checkIfDataReady();
      }
    };

    fetchData();
  }, [user]);

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

  useEffect(() => {
    timeoutRef.current = setTimeout(() => setIsLoading(false), 10000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleKpisChange = (newSelectedKpis: string[]) => {
    setSelectedKpiIds(newSelectedKpis);
    fetch("/api/kpis/selected", { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : { selectedKpis: [] }))
      .then((json) =>
        setSelectedKpis(
          Array.isArray(json?.selectedKpis) ? json.selectedKpis : []
        )
      )
      .catch(() => {});
  };

  const handleDisplayModesChange = (modes: Record<string, KpiDisplayMode>) => {
    setKpiDisplayModes(modes);
    try {
      localStorage.setItem(DISPLAY_MODES_STORAGE_KEY, JSON.stringify(modes));
    } catch {
      // ignore storage errors
    }
  };

  return (
    <>
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
        <div className="px-4 py-6 sm:px-0 space-y-6">
          {/* Upload invitation when no data */}
          {dataStatus && !dataStatus.hasModelData && <UploadInvitation />}

          {/* KPIs Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="text-lg font-semibold">
                Key Performance Indicators
              </h2>
              <div className="flex items-center gap-3">
                <DateRangePicker
                  period={period}
                  customDateRange={customDateRange}
                  onPeriodChange={(value) => setPeriod(value)}
                  onCustomDateRangeChange={(range) => setCustomDateRange(range)}
                />
                <KpiSelector
                  selectedKpiIds={selectedKpiIds}
                  onKpisChange={handleKpisChange}
                  recommendedKpis={recommendedKpis}
                  additionalKpis={additionalKpis}
                  kpiDisplayModes={kpiDisplayModes}
                  onDisplayModesChange={handleDisplayModesChange}
                />
              </div>
            </div>

            {dataStatus?.hasModelData ? (
              <>
                <DashboardInsights />
                <KpisGrid
                  selectedKpis={selectedKpis}
                  displayModes={kpiDisplayModes}
                />
              </>
            ) : (
              <LockedPlaceholder message="Upload your data in the 'Upload' section above to see your KPIs." />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
