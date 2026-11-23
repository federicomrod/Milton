// app/api/restaurant/pos/upload/confirm/route.ts
//
// Confirm a user-adjusted column mapping and import the sales file.
// Saves the mapping to restaurant_company_settings for future auto-detection.
//
// Issue #531: Generic column mapper for non-Revel POS exports.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  requireCapability,
  resolveActor,
  unauthorizedResponse,
} from "@/lib/auth/permissions";
import { revalidateSales } from "@/lib/restaurant/cache-tags";
import * as XLSX from "xlsx";
import { buildNameIndex, normalizeHeader } from "@/lib/restaurant/pos-import";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  normalizeGenericPOSRow,
  computeHeaderFingerprint,
  type SavedColumnMapping,
} from "@/lib/restaurant/pos-import-generic";
import type {
  PosSalesItemInsert,
  SourceType,
  RowValidationError,
} from "@/lib/restaurant/pos-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INSERT_BATCH_SIZE = 500;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

interface ConfirmRequest {
  file_data: string; // base64-encoded file
  file_name: string;
  column_mapping: Record<string, string>;
  date_format: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  decimal_separator: "comma" | "dot";
  mapping_name?: string;
  replace_existing?: boolean;
}

interface UploadSummary {
  inserted_rows: number;
  deleted_rows: number;
  unique_orders: number;
  total_revenue: number;
  unmatched_menu_items: string[];
  unmatched_locations: string[];
  validation_errors: Array<{
    rowIndex: number;
    reason: string;
    rawOrderNumber?: string;
  }>;
  resolved_columns: Record<string, string>;
  total_rows_in_file: number;
  replace_existing: boolean;
  currency: string;
  used_saved_mapping: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorizedResponse();

    // Resolve company (same logic as main upload route)
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

    const actor = await resolveActor(supabase, user.id, { companyId });
    const denied = requireCapability(actor, "imports.run", {
      message: "Tu rol no puede cargar ventas.",
    });
    if (denied) return denied;

    const body: ConfirmRequest = await req.json();
    const {
      file_data,
      file_name,
      column_mapping,
      date_format,
      decimal_separator,
      mapping_name,
      replace_existing,
    } = body;

    // Validate required fields
    if (!file_data || !column_mapping) {
      return NextResponse.json(
        { error: "Faltan datos del archivo o mapeo de columnas." },
        { status: 400 }
      );
    }

    // Validate date_format
    if (!date_format || !["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(date_format)) {
      return NextResponse.json(
        { error: "Formato de fecha inválido. Debe ser DD/MM/YYYY, MM/DD/YYYY o YYYY-MM-DD." },
        { status: 400 }
      );
    }

    // Validate decimal_separator
    if (!decimal_separator || !["comma", "dot"].includes(decimal_separator)) {
      return NextResponse.json(
        { error: "Separador decimal inválido. Debe ser 'comma' o 'dot'." },
        { status: 400 }
      );
    }

    // Validate column_mapping: keys must be known fields, required fields must be present
    const { SALES_LOGICAL_FIELDS } = await import("@/lib/restaurant/pos-import-generic");
    const validFields = Object.keys(SALES_LOGICAL_FIELDS);
    const mappingKeys = Object.keys(column_mapping);

    for (const key of mappingKeys) {
      if (!validFields.includes(key)) {
        return NextResponse.json(
          { error: `Campo desconocido en el mapeo: ${key}` },
          { status: 400 }
        );
      }
    }

    // Check required fields
    const requiredFields = Object.entries(SALES_LOGICAL_FIELDS)
      .filter(([_, spec]) => spec.required)
      .map(([name]) => name);

    for (const field of requiredFields) {
      if (!column_mapping[field]) {
        return NextResponse.json(
          { error: `Falta el campo requerido: ${field}` },
          { status: 400 }
        );
      }
    }

    // If replace_existing not explicitly provided, default to false (not true)
    const shouldReplace = replace_existing === true;

    // Decode file
    const buffer = Buffer.from(file_data, "base64");
    if (buffer.length === 0 || buffer.length > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "Archivo vacío o demasiado grande (máx. 15 MB)." },
        { status: 400 }
      );
    }

    const isCSV = file_name.toLowerCase().endsWith(".csv");
    const sourceType: SourceType = isCSV ? "csv" : "xlsx";

    // Parse file
    let headers: string[] = [];
    let rows: Record<string, unknown>[] = [];

    if (isCSV) {
      // Use real CSV parser for proper quote handling
      const { parseCSV } = await import("@/lib/restaurant/pos-csv-parser");
      try {
        const parsed = parseCSV(buffer);
        headers = parsed.headers;
        rows = parsed.rows;
      } catch (err) {
        return NextResponse.json(
          {
            error: "El archivo CSV está vacío o no tiene datos.",
            details: err instanceof Error ? err.message : String(err),
          },
          { status: 400 }
        );
      }
    } else {
      const workbook = XLSX.read(buffer, {
        type: "buffer",
        raw: true,
        cellDates: false,
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return NextResponse.json(
          { error: "El archivo Excel no tiene hojas." },
          { status: 400 }
        );
      }
      const ws = workbook.Sheets[sheetName];
      rows = XLSX.utils.sheet_to_json(ws, { raw: true, defval: "" }) as Record<
        string,
        unknown
      >[];
      if (rows.length > 0) headers = Object.keys(rows[0]);
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "El archivo no contiene filas de datos." },
        { status: 400 }
      );
    }

    // Validate that all mapped column names exist in headers
    const headerSet = new Set(headers);
    for (const [field, columnName] of Object.entries(column_mapping)) {
      if (columnName && !headerSet.has(columnName)) {
        return NextResponse.json(
          { error: `La columna mapeada "${columnName}" para el campo "${field}" no existe en el archivo.` },
          { status: 400 }
        );
      }
    }

    // Get company currency
    const companyCurrency = await resolveCompanyCurrency(supabase, companyId);

    // Load lookup indexes
    const [menuItemsRes, locationsRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select("id, name, brand_id")
        .eq("company_id", companyId),
      supabase
        .from("restaurant_locations")
        .select("id, name, brand_id")
        .eq("company_id", companyId),
    ]);

    const menuItemRows = (menuItemsRes.data ?? []) as {
      id: string;
      name: string;
      brand_id: string | null;
    }[];
    const locationRows = (locationsRes.data ?? []) as {
      id: string;
      name: string;
      brand_id: string | null;
    }[];

    const menuItemIndex = buildScopedNameIndex(
      menuItemRows.map((m) => ({
        id: m.id,
        name: m.name,
        scopeId: m.brand_id,
      })),
      normalizeHeader
    );
    const locationIndex = buildNameIndex(locationRows);
    const locationBrandIndex = new Map<string, string | null>(
      locationRows.map((l) => [l.id, l.brand_id])
    );

    // Normalize rows
    const inserts: PosSalesItemInsert[] = [];
    const validation_errors: RowValidationError[] = [];
    const unmatchedMenuItems = new Set<string>();
    const unmatchedLocations = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const res = normalizeGenericPOSRow(rows[i], i, {
        company_id: companyId,
        source_type: sourceType,
        currency: companyCurrency,
        column_mapping,
        date_format,
        decimal_separator,
        locationIndex,
        locationBrandIndex,
        menuItemIndex,
      });

      if (!res.ok) {
        validation_errors.push(res.error);
        continue;
      }

      if (res.insert.menu_item_id === null) {
        unmatchedMenuItems.add(res.insert.raw_item_name);
      }
      if (res.insert.location_id === null) {
        const locCol = column_mapping.location;
        if (locCol && rows[i][locCol]) {
          unmatchedLocations.add(String(rows[i][locCol]));
        }
      }

      inserts.push(res.insert);
    }

    if (inserts.length === 0) {
      return NextResponse.json(
        {
          error:
            "No se pudieron procesar filas válidas. Verifica el mapeo de columnas.",
          validation_errors,
        },
        { status: 400 }
      );
    }

    // Replace existing if requested (use shared location-aware dedup)
    let deletedRows = 0;
    if (shouldReplace) {
      const { deleteSalesForReplace } = await import("@/lib/restaurant/pos-dedup");
      
      // Collect resolved location IDs from inserts
      const mappedLocationIds = new Set(
        inserts.map(i => i.location_id).filter(Boolean) as string[]
      );

      const dedupResult = await deleteSalesForReplace(
        supabase,
        companyId,
        inserts,
        mappedLocationIds
      );

      if (dedupResult.error) {
        console.error("[POS Upload Confirm] dedup failed:", dedupResult.error.message);
        return NextResponse.json(
          {
            error: dedupResult.error.message,
            code: dedupResult.error.code,
          },
          { status: 400 }
        );
      }

      deletedRows = dedupResult.deletedCount;
      console.log(
        `[POS Upload Confirm] replace_existing=true, deleted ${deletedRows} rows for company ${companyId}`
      );
    }

    // Batch insert
    let inserted = 0;
    for (let i = 0; i < inserts.length; i += INSERT_BATCH_SIZE) {
      const batch = inserts.slice(i, i + INSERT_BATCH_SIZE);
      const { error: insertError, count } = await supabase
        .from("pos_sales_items")
        .insert(batch, { count: "exact" });
      if (insertError) {
        console.error(
          "[POS Upload Confirm] Insert failed:",
          insertError.message
        );
        return NextResponse.json(
          {
            error: "Error al guardar las filas",
            details: insertError.message,
            inserted_before_failure: inserted,
            deleted_rows: deletedRows,
          },
          { status: 500 }
        );
      }
      inserted += count ?? batch.length;
    }

    // Save the mapping for future use
    const headerFingerprint = computeHeaderFingerprint(headers);
    const newMapping: SavedColumnMapping = {
      header_fingerprint: headerFingerprint,
      mapping_name:
        mapping_name || `Mapeo ${new Date().toISOString().slice(0, 10)}`,
      column_mapping,
      date_format,
      decimal_separator,
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString(),
    };

    // Update or create company settings with new mapping
    // Handle case where migration 083 hasn't been applied yet
    const { data: existingSettings, error: settingsError } = await supabase
      .from("restaurant_company_settings")
      .select("pos_sales_mappings")
      .eq("company_id", companyId)
      .maybeSingle();

    // If migration not applied (42703 or PGRST204), skip saving mapping but continue import
    if (settingsError?.code !== "42703" && settingsError?.code !== "PGRST204") {
      const existingMappings =
        (existingSettings?.pos_sales_mappings as SavedColumnMapping[] | null) ??
        [];

      // Remove old mapping with same fingerprint
      const filteredMappings = existingMappings.filter(
        (m: SavedColumnMapping) => m.header_fingerprint !== headerFingerprint
      );

      // Add new mapping
      const updatedMappings = [...filteredMappings, newMapping];

      const { error: upsertError } = await supabase
        .from("restaurant_company_settings")
        .upsert(
          {
            company_id: companyId,
            pos_sales_mappings: updatedMappings,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id" }
        );

      if (upsertError && upsertError.code !== "42703" && upsertError.code !== "PGRST204") {
        console.warn("[POS Upload Confirm] Could not save mapping:", upsertError.message);
        // Don't fail the import if we can't save the mapping
      }
    }

    // Summary
    const uniqueOrders = new Set(inserts.map((r) => r.order_id)).size;
    const totalRevenue = inserts.reduce(
      (s, r) => s + (r.gross_revenue || 0),
      0
    );

    const summary: UploadSummary = {
      inserted_rows: inserted,
      deleted_rows: deletedRows,
      unique_orders: uniqueOrders,
      total_revenue: totalRevenue,
      unmatched_menu_items: Array.from(unmatchedMenuItems).sort(),
      unmatched_locations: Array.from(unmatchedLocations).sort(),
      validation_errors,
      resolved_columns: column_mapping,
      total_rows_in_file: rows.length,
      replace_existing: shouldReplace,
      currency: companyCurrency,
      used_saved_mapping: false,
    };

    revalidateSales(companyId);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POS Upload Confirm] Error:", message);
    return NextResponse.json(
      { error: "Error al confirmar la importación", details: message },
      { status: 500 }
    );
  }
}
