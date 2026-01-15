// lib/types/kpi.ts
// Types for KPI records from the database

export interface DatabaseKpi {
  id: string;
  name: string;
  definition: string;
  flexibility?: Record<string, unknown>;
  formula?: string | null;
  required_data?: string[] | null;
  created_at?: string;
  updated_at?: string;
}
