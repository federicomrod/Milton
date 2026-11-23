// app/api/restaurant/pos/upload/map/route.ts
//
// Generate AI-suggested column mapping for a sales file that doesn't match
// the Revel format. Called from the UI after the initial upload returns
// needs_mapping: true.
//
// Issue #531: Generic column mapper for non-Revel POS exports.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { unauthorizedResponse } from "@/lib/auth/permissions";
import { suggestColumnMappings } from "@/lib/ai/column-mapper";
import { SALES_LOGICAL_FIELDS } from "@/lib/restaurant/pos-import-generic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface MapRequest {
  headers: string[];
  sample_rows: Record<string, unknown>[];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorizedResponse();

    const body: MapRequest = await req.json();
    const { headers, sample_rows } = body;

    if (!Array.isArray(headers) || headers.length === 0) {
      return NextResponse.json(
        { error: "Se requiere el campo 'headers' con al menos una columna." },
        { status: 400 }
      );
    }

    // Build target fields for AI mapper
    const targetFields = Object.entries(SALES_LOGICAL_FIELDS).map(
      ([name, spec]) => ({
        name,
        type: spec.type,
        required: spec.required,
      })
    );

    // Get AI suggestions
    const aiResult = await suggestColumnMappings({
      headers,
      sampleRows: sample_rows ?? [],
      targetFields,
      tableName: "Sales",
    });

    // Convert AI mappings to our format
    const columnMapping: Record<string, string> = {};
    let highConfidenceCount = 0;

    for (const m of aiResult.mappings) {
      if (m.originalColumn && m.confidence > 0.3) {
        columnMapping[m.standardField] = m.originalColumn;
        if (m.confidence > 0.7) highConfidenceCount++;
      }
    }

    // Check if all required fields are mapped
    const requiredFields = Object.entries(SALES_LOGICAL_FIELDS)
      .filter(([, spec]) => spec.required)
      .map(([name]) => name);

    const unmappedRequired = requiredFields.filter(
      (field) => !columnMapping[field]
    );

    const confidence =
      unmappedRequired.length === 0
        ? Math.min(0.9, highConfidenceCount / requiredFields.length)
        : 0.3;

    return NextResponse.json({
      suggested_mapping: columnMapping,
      unmapped_required: unmappedRequired,
      confidence,
      notes: aiResult.notes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POS Upload Map] Error:", message);
    return NextResponse.json(
      { error: "Error al sugerir el mapeo de columnas", details: message },
      { status: 500 }
    );
  }
}
