// app/api/restaurant/pos/upload/map/route.ts
//
// Generate AI-suggested column mapping for a sales file that doesn't match
// the Revel format. Called from the UI after the initial upload returns
// needs_mapping: true.
//
// Issue #531: Generic column mapper for non-Revel POS exports.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  unauthorizedResponse,
  resolveActor,
  requireCapability,
} from "@/lib/auth/permissions";
import { suggestColumnMappings } from "@/lib/ai/column-mapper";
import { SALES_LOGICAL_FIELDS } from "@/lib/restaurant/pos-import-generic";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SAMPLE_ROWS = 3;

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

    // Resolve company (same logic as /upload)
    let companyId: string | null = null;

    {
      const { data } = await supabase
        .from("companies")
        .select("id")
        .eq("created_by", user.id)
        .maybeSingle();
      if (data?.id) companyId = data.id;
    }

    if (!companyId) {
      const { data } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .maybeSingle();
      if (data?.company_id) companyId = data.company_id;
    }

    if (!companyId) {
      const { data } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.company_id) companyId = data.company_id;
    }

    if (!companyId) {
      const { data } = await supabase
        .from("company_memberships")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.company_id) companyId = data.company_id;
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "No se pudo resolver la empresa del usuario." },
        { status: 404 }
      );
    }

    // Check capability
    const actor = await resolveActor(supabase, user.id, { companyId });
    const denied = requireCapability(actor, "imports.run", {
      message: "Tu rol no puede cargar ventas.",
    });
    if (denied) return denied;

    const body: MapRequest = await req.json();
    const { headers, sample_rows } = body;

    if (!Array.isArray(headers) || headers.length === 0) {
      return NextResponse.json(
        { error: "Se requiere el campo 'headers' con al menos una columna." },
        { status: 400 }
      );
    }

    // Cap sample rows for security (don't send too much to OpenAI)
    const cappedSampleRows = Array.isArray(sample_rows)
      ? sample_rows.slice(0, MAX_SAMPLE_ROWS)
      : [];

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
      sampleRows: cappedSampleRows,
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

    // Detect date format now that we know the date column
    const { detectDateFormat } = await import("@/lib/restaurant/pos-import-generic");
    const dateColumn = columnMapping.date;
    const dateDetection = detectDateFormat(cappedSampleRows, dateColumn);

    return NextResponse.json({
      suggested_mapping: columnMapping,
      unmapped_required: unmappedRequired,
      confidence,
      date_format: dateDetection.format,
      date_format_ambiguous: dateDetection.ambiguous,
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
