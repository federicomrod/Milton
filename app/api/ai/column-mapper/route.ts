import { NextResponse } from "next/server";
import {
  suggestColumnMappings,
  type TargetField,
} from "@/lib/ai/column-mapper";

export async function POST(req: Request) {
  try {
    const payload = await req
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const headers = Array.isArray(payload?.headers)
      ? (payload.headers as string[])
      : [];
    const sampleRows = Array.isArray(payload?.sampleRows)
      ? (payload.sampleRows as Record<string, unknown>[])
      : [];
    const targetFields = Array.isArray(payload?.targetFields)
      ? (payload.targetFields as TargetField[])
      : [];
    const tableName =
      typeof payload?.tableName === "string" ? payload.tableName : "Table";

    if (headers.length === 0 || targetFields.length === 0) {
      return NextResponse.json(
        { error: "headers and targetFields are required" },
        { status: 400 }
      );
    }

    const result = await suggestColumnMappings({
      headers,
      sampleRows,
      targetFields,
      tableName,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[column-mapper] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Column mapper failed" },
      { status: 500 }
    );
  }
}
