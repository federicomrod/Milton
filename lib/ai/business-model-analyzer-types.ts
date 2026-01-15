// lib/ai/business-model-analyzer-types.ts
// Types for the AI Business Model Analyzer API

// Re-export ModelProposal from the model transform module
export type { ModelProposal } from "@/lib/model/transform";

/**
 * All onboarding answers collected from the user
 */
export interface OnboardingAnswers {
  businessType: string;
  businessTypeLabel?: string;
  employees: string;
  goals: string;
  revenue: string;
  dataSources: string;
  systems: string;
}

/**
 * Dataset sample for model refinement
 */
export interface AnalyzerDatasetSample {
  sourceName?: string;
  tableHint?: string | null;
  sampleRows: Record<string, unknown>[];
}

/**
 * Input payload for /api/ai/business-model-analyzer
 * Supports two modes:
 * 1. Onboarding mode: uses `answers` to generate initial model
 * 2. Refinement mode: uses `datasets` and `currentModel` to refine existing model
 */
export interface BusinessModelAnalyzerInput {
  // For onboarding flow
  answers?: OnboardingAnswers;
  // For model refinement flow
  businessType?: string;
  datasets?: AnalyzerDatasetSample[];
  currentModel?: unknown;
}

/**
 * Response from the business model analyzer
 */
export interface BusinessModelAnalyzerResponse {
  success: boolean;
  proposal?: import("@/lib/model/transform").ModelProposal;
  error?: string;
}

// Legacy type alias for backward compatibility
export type BusinessTypeId = string;
