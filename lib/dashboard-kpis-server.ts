/**
 * Server-side KPI fetcher using the same unified calculation APIs as the dashboard.
 * Used by Milton Chat to get KPI values that exactly match what's displayed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DASHBOARD_KPI_MAPPINGS } from "./dashboard-kpis";

export interface FetchDashboardKpisServerOptions {
  supabase: SupabaseClient;
  userId: string;
  fromDate: string;
  toDate: string;
  /** Cookie header from the incoming request (for auth on internal fetches) */
  cookieHeader?: string | null;
  /** Base URL for internal API calls (e.g. https://app.example.com) */
  baseUrl: string;
}

/**
 * Fetches KPI values from the same APIs the dashboard uses.
 * Returns Record<kpiId, number | null> matching the dashboard's analyticsKpiData.
 */
export async function fetchDashboardKpisServer(
  options: FetchDashboardKpisServerOptions
): Promise<Record<string, number | null>> {
  const { supabase, userId, fromDate, toDate, cookieHeader, baseUrl } = options;

  try {
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .single();

    if (!company) return {};

    const { data: businessModel } = await supabase
      .from("business_models")
      .select("business_type, selected_kpi_ids")
      .eq("company_id", company.id)
      .single();

    const businessType = businessModel?.business_type;
    const rawSelected = (businessModel?.selected_kpi_ids as any[]) || [];
    let selectedKpiIds: string[] = [];
    if (
      rawSelected.length > 0 &&
      typeof rawSelected[0] === "object" &&
      rawSelected[0]?.id
    ) {
      selectedKpiIds = (rawSelected as Array<{ id: string }>).map((s) => s.id);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    let analyticsData: Record<string, number> = {};

    if (businessType === "fitness_studio") {
      const [kpisRes, classesRes] = await Promise.all([
        fetch(
          `${baseUrl}/api/analytics/fitness-studio/kpis?from_date=${fromDate}&to_date=${toDate}`,
          { cache: "no-store", headers }
        ),
        fetch(
          `${baseUrl}/api/analytics/fitness-studio/classes-utilization?from_date=${fromDate}&to_date=${toDate}`,
          { cache: "no-store", headers }
        ),
      ]);
      if (kpisRes.ok) {
        const json = await kpisRes.json();
        analyticsData = { ...analyticsData, ...(json.kpis || {}) };
      }
      if (classesRes.ok) {
        const json = await classesRes.json();
        analyticsData = { ...analyticsData, ...(json.kpis || {}) };
      }
    } else if (businessType === "restaurant") {
      const res = await fetch(
        `${baseUrl}/api/analytics/restaurant/kpis?from_date=${fromDate}&to_date=${toDate}`,
        { cache: "no-store", headers }
      );
      if (res.ok) {
        const data = await res.json();
        analyticsData = data.kpis || {};
      }
    } else {
      // ecom and other: unified /api/kpis/calculate
      const res = await fetch(`${baseUrl}/api/kpis/calculate`, {
        method: "POST",
        cache: "no-store",
        headers,
        body: JSON.stringify({ from_date: fromDate, to_date: toDate }),
      });
      if (res.ok) {
        const data = await res.json();
        const calculated = (data.calculatedKpis || []) as Array<{
          id: string;
          currentValue: number | null;
        }>;
        calculated.forEach((kpi) => {
          if (kpi.id != null && kpi.currentValue != null) {
            analyticsData[kpi.id] = kpi.currentValue;
          }
        });
      }
    }

    if (selectedKpiIds.length > 0 && businessType) {
      const mappings = DASHBOARD_KPI_MAPPINGS[businessType];
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const validKpiIds = selectedKpiIds.filter((id) => uuidRegex.test(id));

      if (validKpiIds.length === 0)
        return analyticsData as Record<string, number | null>;

      const { data: kpis } = await supabase
        .from("kpis")
        .select("id, name")
        .in("id", validKpiIds);

      const result: Record<string, number | null> = {};
      if (kpis) {
        kpis.forEach((kpi) => {
          const value = mappings
            ? (analyticsData[mappings[kpi.name]] ?? analyticsData[kpi.id])
            : analyticsData[kpi.id];
          result[kpi.id] = value !== undefined && value !== null ? value : null;
        });
      }
      return result;
    }

    return analyticsData as Record<string, number | null>;
  } catch (err) {
    console.error("[fetchDashboardKpisServer]", err);
    return {};
  }
}
