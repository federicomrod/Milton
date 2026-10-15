import { NextResponse } from "next/server";
import { classifyDataset } from "@/lib/ai/dataset-classifier";

export async function POST(req: Request) {
  try {
    const payload = await req
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const result = await classifyDataset({
      datasetName:
        typeof payload?.datasetName === "string"
          ? payload.datasetName
          : undefined,
      columns: Array.isArray(payload?.columns)
        ? (payload.columns as string[])
        : undefined,
      sampleRows: Array.isArray(payload?.sampleRows)
        ? payload.sampleRows
        : undefined,
      businessContext:
        typeof payload?.businessContext === "string"
          ? payload.businessContext
          : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Dataset classification error:", err);
    return NextResponse.json({
      detectedTable: "unknown",
      confidence: 0,
      suggestedLinks: [],
      notes: "Classifier route caught an error; returned fallback.",
    });
  }
}
