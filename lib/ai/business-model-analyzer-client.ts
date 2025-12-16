"use client";

import type {
  BusinessModelAnalyzerInput,
  ModelProposal,
} from "@/lib/ai/business-model-analyzer-types";

/**
 * Client-side helper to call the AI Business Model Analyzer API
 * Returns a ModelProposal or null if the request fails
 */
export async function callBusinessModelAnalyzer(
  input: BusinessModelAnalyzerInput
): Promise<ModelProposal | null> {
  try {
    const res = await fetch("/api/ai/business-model-analyzer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      console.error("[callBusinessModelAnalyzer] HTTP error", res.status);
      return null;
    }

    const data = await res.json();
    if (!data?.success || !data?.proposal) {
      console.warn("[callBusinessModelAnalyzer] No proposal in response", data);
      return null;
    }

    return data.proposal as ModelProposal;
  } catch (err) {
    console.error("[callBusinessModelAnalyzer] Unexpected error", err);
    return null;
  }
}
