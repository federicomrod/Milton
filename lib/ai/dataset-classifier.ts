// lib/ai/dataset-classifier.ts
//
// Core of app/api/ai/dataset-classifier/route.ts, extracted so restaurant
// imports can classify a sheet without an HTTP hop.

import { openai } from "@/lib/openai-client";

export interface DatasetClassification {
  detectedTable: string;
  confidence: number;
  suggestedLinks: unknown[];
  notes?: string;
}

const FALLBACK: DatasetClassification = {
  detectedTable: "unknown",
  confidence: 0,
  suggestedLinks: [],
  notes: "OpenAI key missing; returned safe fallback.",
};

export async function classifyDataset(input: {
  datasetName?: string;
  columns?: string[];
  sampleRows?: unknown[];
  businessContext?: string;
}): Promise<DatasetClassification> {
  const datasetName = input.datasetName ?? "Unknown Dataset";
  const columns = input.columns ?? [];
  const sampleRows = input.sampleRows ?? [];
  const businessContext = input.businessContext ?? "Unknown";

  if (!process.env.OPENAI_API_KEY) {
    return { ...FALLBACK };
  }

  const systemPrompt = `
You are Milton, an AI data analyst specialized in financial and operational datasets.
Your task is to classify the purpose of a dataset and suggest its relationships.
Always respond in structured JSON only.
Return keys: detectedTable, confidence (0–1), suggestedLinks (array), and notes.
`;

  const userPrompt = `
Business context: ${businessContext || "Unknown"}
Dataset name: ${datasetName}
Columns: ${columns.join(", ")}
Sample rows (first 3):
${JSON.stringify(sampleRows.slice(0, 3), null, 2)}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawContent = completion?.choices?.[0]?.message?.content ?? "{}";
  const cleanedContent = rawContent
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    const result = JSON.parse(cleanedContent) as Partial<DatasetClassification>;
    return {
      detectedTable:
        typeof result.detectedTable === "string"
          ? result.detectedTable
          : "unknown",
      confidence: Number(result.confidence) || 0,
      suggestedLinks: Array.isArray(result.suggestedLinks)
        ? result.suggestedLinks
        : [],
      notes: typeof result.notes === "string" ? result.notes : undefined,
    };
  } catch (parseErr) {
    console.error("Failed to parse classifier output:", rawContent, parseErr);
    return {
      detectedTable: "unknown",
      confidence: 0,
      suggestedLinks: [],
      notes: "Invalid JSON from AI; used fallback.",
    };
  }
}
