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
import { useDateRange } from "@/lib/hooks/useDateRange";

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
  const { user, loading: userLoading } = useUser();

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
  const [loadAttempt, setLoadAttempt] = useState(0);
  const dataLoadedRef = useRef(false);
  const kpisLoadedRef = useRef(false);
  const analyticsLoadedRef = useRef(false);
  const gotBusinessModelRef = useRef(false);
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_RETRIES = 2;

  const { period, customDateRange, setPeriod, setCustomDateRange } =
    useDateRange();

  const checkIfDataReady = () => {
    if (
      dataLoadedRef.current &&
      kpisLoadedRef.current &&
      analyticsLoadedRef.current
    ) {
      if (
        (!gotBusinessModelRef.current || !dataStatus?.hasModelData) &&
        retryCountRef.current < MAX_RETRIES
      ) {
        // All phases finished but no business model was found OR no data is available yet
        // — session may not have been fully initialised on first login or data is still loading
        retryCountRef.current += 1;
        dataLoadedRef.current = false;
        kpisLoadedRef.current = false;
        analyticsLoadedRef.current = false;
        gotBusinessModelRef.current = false;
        setDataStatus(null); // Reset data status so it gets refetched
        setSelectedKpiIds([]); // Reset state to ensure clean re-fetch
        setSelectedKpis([]);
        setRecommendedKpis([]);
        setAdditionalKpis([]);
        setAnalyticsKpiData({});
        setTimeout(() => setLoadAttempt((n) => n + 1), 800);
      } else {
        setTimeout(() => setIsLoading(false), 500);
      }
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      // Wait for user to be available before marking data as loaded
      if (!user || userLoading) return;
      try {
        const statusRes = await fetch("/api/data/status", {
          credentials: "include",
        });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          console.log("[BROWSER LOG] /api/data/status response:", statusData);
          setDataStatus(statusData);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        dataLoadedRef.current = true;
        checkIfDataReady();
      }
    };

    fetchData();
  }, [user, userLoading, loadAttempt]);

  useEffect(() => {
    const loadKpis = async () => {
      if (!user || userLoading) return;
      gotBusinessModelRef.current = false;
      try {
        const supabase = createClient();

        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (company) {
          // Get business model to determine business type, selected KPIs, and ranked KPIs
          const { data: businessModel } = await supabase
            .from("business_models")
            .select("business_type, selected_kpi_ids, ranked_kpi_ids")
            .eq("company_id", company.id)
            .single();

          let selectedKpiIds: string[] = [];
          let kpiDisplayModes: Record<string, any> = {};
          let businessType: string | null = null;

          if (businessModel) {
            gotBusinessModelRef.current = true;
            businessType = businessModel.business_type;
            setBusinessType(businessType);

            const uuidRegex =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

            // Parse selected KPIs and display modes — handles both:
            // - New format: [{id, displayTypes}]
            // - Old format: ["uuid1", "uuid2"] plain UUID strings
            const rawSelected = businessModel.selected_kpi_ids as any[];
            if (rawSelected && rawSelected.length > 0) {
              if (
                typeof rawSelected[0] === "object" &&
                rawSelected[0] !== null
              ) {
                const selections = rawSelected as Array<{
                  id: string;
                  displayTypes: string[];
                }>;
                selectedKpiIds = selections
                  .map((item) => item.id)
                  .filter((id) => uuidRegex.test(id));
                kpiDisplayModes = selections.reduce(
                  (acc, item) => {
                    if (uuidRegex.test(item.id)) {
                      acc[item.id] = item.displayTypes.filter(
                        (type) => type === "card" || type === "chart"
                      );
                    }
                    return acc;
                  },
                  {} as Record<string, any>
                );
              } else if (typeof rawSelected[0] === "string") {
                // Old format: plain UUID strings, default display mode to "card"
                selectedKpiIds = rawSelected.filter(
                  (id) => typeof id === "string" && uuidRegex.test(id)
                );
                kpiDisplayModes = selectedKpiIds.reduce(
                  (acc, id) => {
                    acc[id] = ["card"];
                    return acc;
                  },
                  {} as Record<string, any>
                );
              }
            }
          }

          setSelectedKpiIds(selectedKpiIds);
          setKpiDisplayModes(kpiDisplayModes);

          // Load selected KPIs
          if (selectedKpiIds.length > 0) {
            const { data: selectedKpisData } = await supabase
              .from("kpis")
              .select("*")
              .in("id", selectedKpiIds);
            setSelectedKpis(selectedKpisData || []);
          } else {
            setSelectedKpis([]);
          }

          // Load all template KPIs for the business type, sorted by ranked order when available
          if (businessType) {
            const { data: template } = await supabase
              .from("business_model_templates")
              .select("kpi_ids")
              .eq("key", businessType)
              .single();

            if (template?.kpi_ids && Array.isArray(template.kpi_ids)) {
              const { data: templateKpis } = await supabase
                .from("kpis")
                .select("*")
                .in("id", template.kpi_ids);

              if (templateKpis && templateKpis.length > 0) {
                console.log(
                  "[Dashboard] Template KPIs loaded:",
                  templateKpis.length
                );

                // Sort by ranked order if available, otherwise use template order
                let sortedKpis = templateKpis;
                if (
                  businessModel?.ranked_kpi_ids &&
                  Array.isArray(businessModel.ranked_kpi_ids)
                ) {
                  // Create a map of KPI ID to rank position
                  const rankMap = new Map();
                  businessModel.ranked_kpi_ids.forEach((id, index) => {
                    rankMap.set(id, index);
                  });

                  // Sort KPIs: ranked first (by rank order), then unranked
                  sortedKpis = templateKpis.sort((a, b) => {
                    const aRank = rankMap.get(a.id);
                    const bRank = rankMap.get(b.id);

                    if (aRank !== undefined && bRank !== undefined) {
                      return aRank - bRank; // Both ranked, sort by rank
                    } else if (aRank !== undefined) {
                      return -1; // a is ranked, b is not
                    } else if (bRank !== undefined) {
                      return 1; // b is ranked, a is not
                    } else {
                      return 0; // Neither ranked, maintain order
                    }
                  });
                }

                console.log(
                  "[Dashboard] Sorted KPIs:",
                  sortedKpis.map((k) => k.name)
                );
                setRecommendedKpis(sortedKpis.slice(0, 6));
                setAdditionalKpis(sortedKpis.slice(6));
              } else {
                loadFallbackKpis();
              }
            } else {
              loadFallbackKpis();
            }
          } else {
            loadFallbackKpis();
          }

          function loadFallbackKpis() {
            // No business type, use all published KPIs
            supabase
              .from("kpis")
              .select("*")
              .eq("is_published", true)
              .order("name")
              .then(({ data: allKpis }) => {
                console.log(
                  "[Dashboard] Using fallback all KPIs:",
                  allKpis?.length || 0
                );
                setRecommendedKpis(allKpis?.slice(0, 5) || []);
                setAdditionalKpis(allKpis?.slice(5) || []);
              });
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
  }, [user, userLoading, loadAttempt]);

  // Fetch analytics KPI data when date range changes
  useEffect(() => {
    const loadAnalyticsData = async () => {
      if (businessType && selectedKpiIds.length > 0) {
        // Real fetch — mark done after data arrives
        try {
          const data = await fetchDashboardKpis(
            period,
            customDateRange,
            selectedKpiIds
          );
          setAnalyticsKpiData(data);
        } catch (err) {
          console.error("[Dashboard] Error loading analytics data:", err);
          setAnalyticsKpiData({});
        }
        analyticsLoadedRef.current = true;
        checkIfDataReady();
      } else if (kpisLoadedRef.current) {
        // KPIs have been loaded but none are selected — nothing to fetch, we're done
        setAnalyticsKpiData({});
        analyticsLoadedRef.current = true;
        checkIfDataReady();
      }
      // If kpisLoadedRef is not set yet, KPI definitions haven't arrived —
      // don't mark analytics done; loadKpis will trigger this effect again
      // once businessType / selectedKpiIds are populated.
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
    // Filter out non-UUID legacy identifiers
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const validKpiIds = newSelectedKpis.filter((id) => uuidRegex.test(id));

    setSelectedKpiIds(validKpiIds);

    // Reload selected KPIs from database
    if (validKpiIds.length > 0) {
      const supabase = createClient();
      const { data: kpis } = await supabase
        .from("kpis")
        .select("*")
        .in("id", validKpiIds);

      setSelectedKpis(kpis || []);
    } else {
      setSelectedKpis([]);
    }
  };

  const handleDisplayModesChange = async (
    modes: Record<string, KpiDisplayMode>
  ) => {
    // Only save display modes for currently selected KPIs to database
    const selectedKpiModes = Object.fromEntries(
      selectedKpiIds.map((id) => [id, modes[id] || ["card"]])
    );

    setKpiDisplayModes((prev) => ({ ...prev, ...selectedKpiModes }));

    // Save to database in the new combined format
    try {
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
          // Convert display modes to the combined format - only for selected KPIs
          const selectedKpisWithDisplayTypes = selectedKpiIds.map((id) => ({
            id,
            displayTypes: selectedKpiModes[id] || ["card"],
          }));

          await supabase
            .from("business_models")
            .update({ selected_kpi_ids: selectedKpisWithDisplayTypes })
            .eq("company_id", company.id);

          console.log(
            "[handleDisplayModesChange] Saved display modes to database"
          );
        }
      }
    } catch (error) {
      console.error("Error saving display modes to database:", error);
    }
  };

  return (
    <>
      {(isLoading || userLoading) && (
        <div className="fixed inset-0 bg-background/90 backdrop-blur-md z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6">
            <Loader2 className="h-16 w-16 animate-spin text-primary" />
            <p className="text-lg font-medium text-foreground">
              {userLoading ? "Loading user data..." : "Loading dashboard..."}
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

            {dataStatus === null ? null : dataStatus.hasModelData ? (
              <>
                <DashboardInsights />
                <KpisGrid
                  selectedKpis={selectedKpis}
                  displayModes={kpiDisplayModes}
                  analyticsKpiData={analyticsKpiData}
                  period={period}
                  customDateRange={customDateRange}
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
