// lib/kpi-availability.ts
// Simplified KPI availability - now handled by database KPI required_data field

export type KpiAvailabilityStatus = "available" | "requiresData";

export interface KpiAvailability {
  id: string;
  status: KpiAvailabilityStatus;
  reason?: string;
}

// Simplified function - availability is now determined by template KPI editor
// based on database KPI required_data field
export function evaluateKpiAvailability(
  businessType: string,
  model: any,
  templates: any[]
): KpiAvailability[] {
  // Return all templates as available since availability is now checked
  // in the template editor based on selected data tables
  return templates.map((tpl) => ({
    id: tpl.id,
    status: "available" as const,
  }));
}
