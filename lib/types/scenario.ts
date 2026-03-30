// lib/types/scenario.ts
// Types for planning & scenario modeling

import type { DriverSection } from "@/lib/scenario-drivers";

export type ScenarioStatus = "Draft" | "Projected" | "Ready";

export interface Scenario {
  id: string;
  name: string;
  createdDate: string;
  status: ScenarioStatus;
  tags?: string[];
}

/** DB row shape for planning_scenarios table */
export interface PlanningScenarioRow {
  id: string;
  company_id: string;
  name: string;
  status: ScenarioStatus;
  tags: string[] | null;
  driver_overrides: unknown;
  projected_results: ProjectedResultsSnapshot | null;
  baseline_scenario_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Snapshot stored when scenario is run (status Projected/Ready) */
export interface ProjectedResultsSnapshot {
  kpis?: Array<{
    title: string;
    value: string;
    delta: string;
    deltaPercent: string;
    isPositive: boolean;
  }>;
  changes?: Array<{
    driver: string;
    category: string;
    baseline: string;
    scenario: string;
  }>;
  chartData?: Record<string, number | string>[];
}

/** Map DB row to list/card Scenario */
export function mapRowToScenario(row: PlanningScenarioRow): Scenario {
  const created = row.created_at
    ? new Date(row.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  return {
    id: row.id,
    name: row.name,
    createdDate: created,
    status: row.status,
    tags: row.tags ?? undefined,
  };
}

/** Parse driver_overrides from DB; returns empty array if invalid */
export function parseDriverOverrides(raw: unknown): DriverSection[] {
  if (Array.isArray(raw)) return raw as DriverSection[];
  return [];
}
