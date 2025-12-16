// lib/ai/business-model-analyzer-types.ts
// Types for the AI Business Model Analyzer API

export type BusinessTypeId = "saas" | "agency" | "fitness_studio";

export interface AnalyzerDatasetSample {
  sourceName?: string; // e.g. "bookings.xlsx", "payments.csv"
  tableHint?: string | null; // optional, e.g. "Bookings", "Payments"
  sampleRows: Record<string, unknown>[]; // first N rows from the parsed file
}

/**
 * Input payload for /api/ai/business-model-analyzer
 */
export interface BusinessModelAnalyzerInput {
  businessType: BusinessTypeId;
  datasets?: AnalyzerDatasetSample[];
  // optional: pass an existing model if we want the AI to refine it
  currentModel?: unknown;
}

// Re-export ModelProposal from the model transform module
export type { ModelProposal } from "@/lib/model/transform";
