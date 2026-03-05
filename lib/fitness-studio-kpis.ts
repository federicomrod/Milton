// lib/fitness-studio-kpis.ts
// Utility functions for fetching and mapping fitness studio KPIs from the database

import { createClient } from "@/lib/supabase/client";

export interface DatabaseKpi {
  id: string;
  name: string;
  definition: string;
  formula?: string | null;
  required_data?: string[] | null;
}

/**
 * Maps KPI database names to API response field names
 * For Studio Performance dashboard
 */
export const KPI_NAME_TO_API_FIELD: Record<string, string> = {
  "Active Members (End of Month)": "activeMembers",
  "New Members": "newMembers",
  "Churned Members": "churnedMembers",
  "Churn Rate": "churnRate",
  "Member Tenure": "avgTenure",
  "Revenue per Member (ARPM)": "revenuePerMember",
  "Capacity Utilization": "capacityUtilization",
  "Average Class Size": "averageClassSize",
  "Studio Utilization": "utilizationRate",
  "Cancellation Rate": "cancellationRate",
  "Class Attendance Rate": "avgClassOccupancy", // This is "Avg. class occupancy"
  "Average Class Occupancy": "avgClassOccupancy", // Alternative name
  "Revenue per Class": "revenuePerClass",
};

/**
 * Maps API field names to trend field names (for Classes & Utilization)
 */
export const API_FIELD_TO_TREND_FIELD: Record<string, string> = {
  avgClassOccupancy: "avgClassOccupancy",
  revenuePerClass: "revenuePerClass",
  cancellationRate: "cancellationRate",
};

/**
 * Fetches KPIs for fitness studio business model from the database
 * Fetches all KPIs that are relevant to fitness studio (by name patterns)
 */
export async function getFitnessStudioKpis(): Promise<DatabaseKpi[]> {
  try {
    const supabase = createClient();

    // Fetch all KPIs that match fitness studio patterns
    // These are the KPIs that should be displayed in the fitness studio dashboards
    const fitnessStudioKpiPatterns = [
      "Active Members",
      "New Members",
      "Churned Members",
      "Churn Rate",
      "Member Tenure",
      "Revenue per Member",
      "Capacity Utilization",
      "Studio Utilization",
      "Cancellation Rate",
      "Class Attendance",
      "Average Class Size",
      "Revenue per Class",
      "Table Utilization",
    ];

    // Build OR conditions for ILIKE queries
    const orConditions = fitnessStudioKpiPatterns
      .map((pattern) => `name.ilike.%${pattern}%`)
      .join(",");

    // Fetch KPIs that match any of the patterns
    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("*")
      .or(
        fitnessStudioKpiPatterns
          .map((pattern) => `name.ilike.%${pattern}%`)
          .join(",")
      );

    if (kpisError) {
      console.error("[getFitnessStudioKpis] Error fetching KPIs:", kpisError);
      return [];
    }

    return (kpis as DatabaseKpi[]) || [];
  } catch (err) {
    console.error("[getFitnessStudioKpis] Unexpected error:", err);
    return [];
  }
}

/**
 * Gets the API field name for a KPI based on its database name
 */
export function getApiFieldForKpi(kpiName: string): string | null {
  return KPI_NAME_TO_API_FIELD[kpiName] || null;
}

/**
 * Filters KPIs that should be displayed in Studio Performance dashboard
 */
export function getStudioPerformanceKpis(kpis: DatabaseKpi[]): DatabaseKpi[] {
  const studioPerformanceKpiNames = [
    "Active Members (End of Month)",
    "New Members",
    "Churn Rate",
    "Member Tenure",
    "Revenue per Member (ARPM)",
    "Studio Utilization", // This is "Utilization rate"
    "Cancellation Rate",
  ];

  return kpis.filter((kpi) => studioPerformanceKpiNames.includes(kpi.name));
}

/**
 * Filters KPIs that should be displayed in Classes & Utilization dashboard
 * Based on requirements: Avg. class occupancy, Revenue per class, Cancellation rate, Capacity utilization
 */
export function getClassesUtilizationKpis(kpis: DatabaseKpi[]): DatabaseKpi[] {
  const classesUtilizationKpiNames = [
    "Class Attendance Rate", // This is "Avg. class occupancy"
    "Average Class Occupancy", // Alternative name
    "Average Class Size", // Total attended spots ÷ nº of class occurrences
    "Revenue per Class",
    "Cancellation Rate",
    "Capacity Utilization",
  ];

  return kpis.filter((kpi) => classesUtilizationKpiNames.includes(kpi.name));
}
