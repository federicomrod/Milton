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
import { fetchDashboardKpis } from "@/lib/dashboard-kpis";
import { createClient } from "@/lib/supabase/client";

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
  const [analyticsKpiData, setAnalyticsKpiData] = useState<
    Record<string, number | null>
  >({});
  const [businessType, setBusinessType] = useState<string | null>(null);

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
        // Get business model and selected KPIs
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: company } = await supabase
            .from("companies")
            .select("id")
            .eq("created_by", user.id)
            .single();

          if (company) {
            const { data: businessModel } = await supabase
              .from("business_models")
              .select("business_type, selected_kpi_ids")
              .eq("company_id", company.id)
              .single();

            if (businessModel) {
              setBusinessType(businessModel.business_type);

              // Get selected KPI IDs - filter out legacy non-UUID identifiers
              const rawKpiIds =
                (businessModel.selected_kpi_ids as string[]) || [];
              const uuidRegex =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
              const validKpiIds = rawKpiIds.filter((id) => uuidRegex.test(id));
              setSelectedKpiIds(validKpiIds);

              // Fetch KPI definitions for selected KPIs
              if (validKpiIds.length > 0) {
                console.log(
                  "[Dashboard] Loading KPIs - valid IDs:",
                  validKpiIds
                );

                const { data: kpis } = await supabase
                  .from("kpis")
                  .select("*")
                  .in("id", validKpiIds);

                console.log(
                  "[Dashboard] Found KPIs:",
                  kpis?.length || 0,
                  kpis?.map((k) => k.name)
                );
                setSelectedKpis(kpis || []);
              } else {
                console.log("[Dashboard] No valid KPI IDs found");
                setSelectedKpis([]);
              }

              // Get all available KPIs
              const { data: allKpis } = await supabase
                .from("kpis")
                .select("*")
                .eq("is_published", true)
                .order("name");

              if (allKpis) {
                // For fitness studio, show key KPIs as recommended
                let recommendedKpis, additionalKpis;
                if (businessType === "fitness_studio") {
                  const keyFitnessKpis = [
                    "Active Members (End of Month)",
                    "New Members",
                    "Churn Rate",
                    "Member Tenure",
                    "Revenue per Member (ARPM)",
                  ];

                  recommendedKpis = allKpis.filter((kpi) =>
                    keyFitnessKpis.includes(kpi.name)
                  );
                  additionalKpis = allKpis.filter(
                    (kpi) => !keyFitnessKpis.includes(kpi.name)
                  );
                } else {
                  // For other business types, show first 5 as recommended
                  recommendedKpis = allKpis.slice(0, 5);
                  additionalKpis = allKpis.slice(5);
                }

                console.log(
                  "[Dashboard] Recommended KPIs:",
                  recommendedKpis.map((k) => k.name)
                );
                console.log(
                  "[Dashboard] Additional KPIs:",
                  additionalKpis.length
                );

                setRecommendedKpis(recommendedKpis);
                setAdditionalKpis(additionalKpis);
              }
            }
          }
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

  // Fetch analytics KPI data when date range changes
  useEffect(() => {
    const loadAnalyticsData = async () => {
      if (businessType && selectedKpiIds.length > 0) {
        console.log(
          "[Dashboard] Loading analytics data for business type:",
          businessType,
          "KPIs:",
          selectedKpiIds.length,
          "IDs:",
          selectedKpiIds
        );
        const data = await fetchDashboardKpis(
          period,
          customDateRange,
          selectedKpiIds
        );
        console.log(
          "[Dashboard] Analytics data received for",
          Object.keys(data).length,
          "KPIs:",
          Object.keys(data)
        );
        setAnalyticsKpiData(data);
      } else {
        console.log(
          "[Dashboard] Skipping analytics load - businessType:",
          businessType,
          "selectedKpiIds:",
          selectedKpiIds
        );
        setAnalyticsKpiData({});
      }
    };

    loadAnalyticsData();
  }, [
    period,
    customDateRange.from,
    customDateRange.to,
    businessType,
    selectedKpiIds,
  ]);

  useEffect(() => {
    timeoutRef.current = setTimeout(() => setIsLoading(false), 10000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleKpisChange = async (newSelectedKpis: string[]) => {
    try {
      console.log("[handleKpisChange] New selected KPIs:", newSelectedKpis);

      // Filter out non-UUID legacy identifiers
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const validKpiIds = newSelectedKpis.filter((id) => uuidRegex.test(id));

      console.log("[handleKpisChange] Valid KPI IDs:", validKpiIds);

      setSelectedKpiIds(validKpiIds);

      // Save to business model
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (company) {
          await supabase
            .from("business_models")
            .update({ selected_kpi_ids: validKpiIds })
            .eq("company_id", company.id);
        }
      }

      // Reload selected KPIs from database
      if (validKpiIds.length > 0) {
        const { data: kpis } = await supabase
          .from("kpis")
          .select("*")
          .in("id", validKpiIds);

        console.log("[handleKpisChange] Reloaded KPIs:", kpis);
        setSelectedKpis(kpis || []);
      } else {
        setSelectedKpis([]);
      }
    } catch (error) {
      console.error("Error saving KPI selection:", error);
    }
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
                  analyticsKpiData={analyticsKpiData}
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
