// app/api/restaurant/pos/upload/route.ts
// Sales file upload: Revel-style item-level POS export OR generic column-mapped format.
//
// Two modes (issue #531):
// 1. Revel "Customer Items" export: validates and imports directly (backward compatible).
// 2. Generic POS export: returns mapping preview for user confirmation, then imports.
//
// Flow:
// - POST /api/restaurant/pos/upload: Detect format and either import (Revel) or return preview
// - POST /api/restaurant/pos/upload/confirm: Import with user-confirmed mapping
//
// Auth: requires an authenticated Supabase user. company_id is resolved from
// the user's company row (created_by) — same pattern as the existing data
// upload routes in app/api/data/*.

import { fmt } from "@/lib/i18n";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import {
  requireCapability,
  resolveActor,
  unauthorizedResponse,
} from "@/lib/auth/permissions";
import { revalidateSales } from "@/lib/restaurant/cache-tags";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import {
  validateRevelPOSColumns,
  normalizeRevelPOSRow,
  buildNameIndex,
  normalizeHeader,
  type PosSalesItemInsert,
  type SourceType,
  type RowValidationError,
} from "@/lib/restaurant/pos-import";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Supabase has practical limits on insert batch size; 500 keeps payload
// comfortably under typical request body caps.
const INSERT_BATCH_SIZE = 500;
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB — Revel exports get large quickly.

interface UploadSummary {
  inserted_rows: number;
  /**
   * Rows deleted from pos_sales_items prior to insert when the user requested
   * "replace existing". 0 when replace was off (append-only mode) or when the
   * company had no existing rows. NEVER includes rows from other companies —
   * the delete is filtered by company_id and gated by RLS.
   */
  deleted_rows: number;
  unique_orders: number;
  total_revenue: number;
  unmatched_menu_items: string[]; // distinct raw product names with no menu_items match
  unmatched_locations: string[]; // distinct establishment names with no location match
  validation_errors: RowValidationError[];
  resolved_columns: Record<string, string>;
  total_rows_in_file: number;
  /** Echoes the replace flag back so the UI can confirm what happened. */
  replace_existing: boolean;
  currency: string;
}

export async function POST(req: NextRequest) {
  const d = await apiDictionary();
  try {
    // --- Auth -------------------------------------------------------------
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return unauthorizedResponse();
    }

    // --- Resolve tenant context ------------------------------------------
    // Robust three-step fallback so manually-inserted companies and pilot users
    // whose row was linked via company_memberships are all found.
    //
    // Step 1: canonical path — companies.created_by = user.id
    // Step 2: profiles table where id = user.id (Supabase sometimes uses id as PK = auth.uid())
    // Step 3: profiles table where user_id = user.id (older profile schema)
    // Step 4: company_memberships where user_id = user.id → resolve company_id
    //
    // If none of these yield a company we return a diagnostic 404 — never weaken auth.

    let companyId: string | null = null;

    // Step 1 — companies.created_by
    {
      const { data, error } = await supabase
        .from("companies")
        .select("id")
        .eq("created_by", user.id)
        .maybeSingle();
      if (!error && data?.id) companyId = data.id;
    }

    // Step 2 — profiles.id = user.id → profiles.company_id
    if (!companyId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .maybeSingle();
      if (!error && data?.company_id) companyId = data.company_id;
    }

    // Step 3 — profiles.user_id = user.id → profiles.company_id
    if (!companyId) {
      const { data, error } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!error && data?.company_id) companyId = data.company_id;
    }

    // Step 4 — company_memberships.user_id = user.id → company_id
    if (!companyId) {
      const { data, error } = await supabase
        .from("company_memberships")
        .select("company_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!error && data?.company_id) companyId = data.company_id;
    }

    if (!companyId) {
      // Gather diagnostic counts to make the 404 actionable without leaking data.
      const [profilesByIdRes, profilesByUserIdRes, membershipsRes] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("id", user.id),
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),
          supabase
            .from("company_memberships")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),
        ]);
      console.error(
        `[POS Upload] Company not found for user ${user.id}. ` +
          `profiles(id)=${profilesByIdRes.count ?? "err"}, ` +
          `profiles(user_id)=${profilesByUserIdRes.count ?? "err"}, ` +
          `memberships=${membershipsRes.count ?? "err"}`
      );
      return NextResponse.json(
        {
          error: d.connect.api.companyNotFound,
          message:
            "No company could be resolved via created_by, profiles.id, profiles.user_id, or company_memberships. " +
            "Ensure the user is linked to a company in at least one of these tables.",
          user_id: user.id,
          checked_profiles_id_count: profilesByIdRes.count ?? null,
          checked_profiles_user_id_count: profilesByUserIdRes.count ?? null,
          checked_memberships_count: membershipsRes.count ?? null,
        },
        { status: 404 }
      );
    }

    const actor = await resolveActor(supabase, user.id, { companyId });
    const denied = requireCapability(actor, "imports.run", {
      message: d.connect.api.salesUploadDenied,
    });
    if (denied) return denied;

    // --- File handling ----------------------------------------------------
    const formData = await req.formData();
    const file = formData.get("file");
    // `replace_existing` is the duplicate-protection toggle from the upload UI.
    // We accept several truthy spellings because HTML form encoding of a
    // <input type="checkbox"> can vary by client framework.
    const replaceRaw = formData.get("replace_existing");
    const replaceExisting =
      replaceRaw === "true" || replaceRaw === "1" || replaceRaw === "on";
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: d.connect.api.uploadFile },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: d.connect.api.fileEmpty },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: fmt(d.connect.api.fileTooBigMb, {
            mb: MAX_FILE_BYTES / 1024 / 1024,
          }),
        },
        { status: 400 }
      );
    }

    const isCSV = file.name.toLowerCase().endsWith(".csv");
    const sourceType: SourceType = isCSV ? "csv" : "xlsx";

    // --- Parse ------------------------------------------------------------
    const buffer = Buffer.from(await file.arrayBuffer());
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
            error: d.connect.api.fileEmpty,
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
          { error: d.connect.api.noSheets },
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
        { error: d.connect.api.fileEmpty },
        { status: 400 }
      );
    }

    // --- Column validation -----------------------------------------------
    // Try Revel format first (backward compatible)
    const colCheck = validateRevelPOSColumns(headers);

    // If not Revel format, switch to generic mapper mode (issue #531)
    if (!colCheck.ok) {
      // Import generic detection utilities
      const { computeHeaderFingerprint, detectDecimalSeparator, detectDateFormat } =
        await import("@/lib/restaurant/pos-import-generic");

      const headerFingerprint = computeHeaderFingerprint(headers);
      const decimalSeparator = detectDecimalSeparator(rows);

      // Check if we have a saved mapping for this header fingerprint
      const { data: settings, error: settingsError } = await supabase
        .from("restaurant_company_settings")
        .select("pos_sales_mappings")
        .eq("company_id", companyId)
        .maybeSingle();

      // Handle case where migration 083 hasn't been applied yet (PGRST204 or 42703)
      const savedMappings =
        settingsError?.code === "42703" || settingsError?.code === "PGRST204"
          ? []
          : (settings?.pos_sales_mappings as any[] | null) ?? [];
      const matchedMapping = savedMappings.find(
        (m: any) => m.header_fingerprint === headerFingerprint
      );

      if (matchedMapping) {
        // We have a saved mapping - use it automatically
        // Continue with generic import using matchedMapping.column_mapping
        // Store mapping details for later use
        (req as any)._savedMapping = matchedMapping;
        (req as any)._decimalSeparator = decimalSeparator;
        (req as any)._useGenericImport = true;
      } else {
        // No saved mapping - return preview for user to confirm
        // Detect date format (we don't have a date column yet, so pass undefined)
        const dateDetection = detectDateFormat(rows, undefined);

        return NextResponse.json(
          {
            needs_mapping: true,
            header_fingerprint: headerFingerprint,
            headers,
            sample_rows: rows.slice(0, 3), // Max 3 rows for security
            decimal_separator: decimalSeparator,
            date_format: dateDetection.format,
            date_format_ambiguous: dateDetection.ambiguous,
            message:
              "Este archivo necesita mapeo de columnas. Por favor, confirma o ajusta el mapeo sugerido.",
          },
          { status: 200 }
        );
      }
    }

    const company = { id: companyId };
    const companyCurrency = await resolveCompanyCurrency(supabase, company.id);

    // Pull lookup data for soft-matching menu_item_id and location_id.
    // We tolerate the case where these tables exist but are empty (e.g. a fresh
    // tenant): empty Map → all rows insert with menu_item_id / location_id null.
    const [menuItemsRes, locationsRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select("id, name, brand_id")
        .eq("company_id", company.id),
      supabase
        .from("restaurant_locations")
        .select("id, name, brand_id")
        .eq("company_id", company.id),
    ]);

    if (menuItemsRes.error) {
      console.error(
        "[POS Upload] menu_items lookup failed:",
        menuItemsRes.error.message
      );
    }
    if (locationsRes.error) {
      console.error(
        "[POS Upload] restaurant_locations lookup failed:",
        locationsRes.error.message
      );
    }

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

    // Menu items are matched scoped by brand (see pos-import.ts /
    // scoped-matching.ts) — never guessed across brands.
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

    // --- Normalize rows ---------------------------------------------------
    const inserts: PosSalesItemInsert[] = [];
    const validation_errors: RowValidationError[] = [];
    const unmatchedMenuItems = new Set<string>();
    const unmatchedLocations = new Set<string>();

    // Check if we're using generic import (non-Revel format)
    const useGenericImport = (req as any)._useGenericImport;
    const savedMapping = (req as any)._savedMapping;
    const decimalSeparator = (req as any)._decimalSeparator;

    if (useGenericImport && savedMapping) {
      // Generic import path with saved mapping
      const { normalizeGenericPOSRow } =
        await import("@/lib/restaurant/pos-import-generic");

      for (let i = 0; i < rows.length; i++) {
        const res = normalizeGenericPOSRow(rows[i], i, {
          company_id: company.id,
          source_type: sourceType,
          currency: companyCurrency,
          column_mapping: savedMapping.column_mapping,
          decimal_separator: decimalSeparator,
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
          const locCol = savedMapping.column_mapping.location;
          if (locCol && rows[i][locCol]) {
            unmatchedLocations.add(String(rows[i][locCol]));
          }
        }

        inserts.push(res.insert);
      }
    } else {
      // Revel import path (original behavior)
      for (let i = 0; i < rows.length; i++) {
        const res = normalizeRevelPOSRow(rows[i], i, {
          company_id: company.id,
          source_type: sourceType,
          currency: companyCurrency,
          locationIndex,
          locationBrandIndex,
          menuItemIndex,
          columns: colCheck.resolved,
        });

        if (!res.ok) {
          validation_errors.push(res.error);
          continue;
        }

        if (res.insert.menu_item_id === null) {
          unmatchedMenuItems.add(res.insert.raw_item_name);
        }
        if (res.insert.location_id === null) {
          const estCol = colCheck.resolved.establishment;
          if (estCol && rows[i][estCol]) {
            unmatchedLocations.add(String(rows[i][estCol]));
          }
        }

        inserts.push(res.insert);
      }
    }

    if (inserts.length === 0) {
      return NextResponse.json(
        {
          error: d.connect.api.noValidRows,
          validation_errors,
        },
        { status: 400 }
      );
    }

    // --- Replace-existing branch -----------------------------------------
    // When the user opts in, delete only the pos_sales_items rows in the
    // date range of this file (and location if mapped), not the whole history.
    // This prevents accidental data loss from uploading a partial file.
    //
    // Safety:
    //   * the delete is filtered by company_id, sale_date range, and
    //     optionally location_id
    //   * we use the same anon/cookie-bound client as the rest of the
    //     route — no service role, no RLS bypass.
    //   * we count the deleted rows for the summary so the UI can show the
    //     user exactly what happened.
    //
    // We delete BEFORE inserting so that an empty / failing replace doesn't
    // leave the table half-cleared after a successful insert.
    let deletedRows = 0;
    if (replaceExisting) {
      // Extract date range from the inserts
      const { extractDateRange } = await import("@/lib/restaurant/pos-import-generic");
      const dateRange = extractDateRange(inserts);

      if (dateRange) {
        const [minDate, maxDate] = dateRange;
        
        // Build delete query with date range filter
        let deleteQuery = supabase
          .from("pos_sales_items")
          .delete({ count: "exact" })
          .eq("company_id", company.id)
          .gte("sale_date", minDate)
          .lte("sale_date", maxDate);

        // If a location column is mapped and all rows have the same location,
        // also filter by location_id to avoid deleting other locations' data
        const uniqueLocations = new Set(inserts.map(i => i.location_id).filter(Boolean));
        if (uniqueLocations.size === 1) {
          const singleLocationId = [...uniqueLocations][0];
          deleteQuery = deleteQuery.eq("location_id", singleLocationId);
        }

        const { error: delError, count: delCount } = await deleteQuery;
        
        if (delError) {
          console.error(
            "[POS Upload] replace-existing delete failed:",
            delError.message
          );
          return NextResponse.json(
            {
              error: d.connect.api.replaceFailed,
              details: delError.message,
            },
            { status: 500 }
          );
        }
        deletedRows = delCount ?? 0;
        console.log(
          `[POS Upload] replace_existing=true, deleted ${deletedRows} rows for company ${company.id}, dates ${minDate} to ${maxDate}`
        );
      }
    }

    // --- Batch insert -----------------------------------------------------
    let inserted = 0;
    for (let i = 0; i < inserts.length; i += INSERT_BATCH_SIZE) {
      const batch = inserts.slice(i, i + INSERT_BATCH_SIZE);
      const { error: insertError, count } = await supabase
        .from("pos_sales_items")
        .insert(batch, { count: "exact" });
      if (insertError) {
        // Stop on first batch failure so we don't half-import a file.
        console.error("[POS Upload] insert failed:", insertError.message);
        return NextResponse.json(
          {
            error: d.connect.api.rowsSaveFailed,
            details: insertError.message,
            inserted_before_failure: inserted,
            deleted_rows: deletedRows,
          },
          { status: 500 }
        );
      }
      inserted += count ?? batch.length;
    }

    // --- Summary ----------------------------------------------------------
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
      resolved_columns: colCheck.resolved,
      total_rows_in_file: rows.length,
      replace_existing: replaceExisting,
      currency: companyCurrency,
    };

    // New sales rows: the cached sales cube / Cockpit rollup are out of date.
    revalidateSales(company.id);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POS Upload] Unexpected error:", message);
    return NextResponse.json(
      { error: d.connect.api.uploadFailed, details: message },
      { status: 500 }
    );
  }
}
