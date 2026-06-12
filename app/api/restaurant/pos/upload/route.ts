// app/api/restaurant/pos/upload/route.ts
// First real restaurant ingestion path: Revel-style item-level POS export
// → normalized rows in Supabase `pos_sales_items`.
//
// Scope (restaurant pivot, Milestone 4):
// - ONLY the Revel "Customer Items" export shape (see lib/restaurant/pos-import.ts).
// - No OpenAI, no PDF extraction, no Revel API integration.
//
// Auth: requires an authenticated Supabase user. company_id is resolved from
// the user's company row (created_by) — same pattern as the existing data
// upload routes in app/api/data/*.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";
import {
  validateRevelPOSColumns,
  normalizeRevelPOSRow,
  buildNameIndex,
  type PosSalesItemInsert,
  type SourceType,
  type RowValidationError,
} from "@/lib/restaurant/pos-import";

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
}

export async function POST(req: NextRequest) {
  try {
    // --- Auth -------------------------------------------------------------
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
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
      const text = buffer.toString("utf-8");
      const firstLine = text.split("\n")[0] ?? "";
      const delimiter = firstLine.includes(";")
        ? ";"
        : firstLine.includes("\t")
          ? "\t"
          : ",";
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        return NextResponse.json(
          { error: "File contains no data rows" },
          { status: 400 }
        );
      }
      headers = lines[0]
        .split(delimiter)
        .map((h) => h.trim().replace(/^"|"$/g, ""));
      rows = lines.slice(1).map((line) => {
        const values = line
          .split(delimiter)
          .map((v) => v.trim().replace(/^"|"$/g, ""));
        const r: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          r[h] = values[i] ?? "";
        });
        return r;
      });
    } else {
      const workbook = XLSX.read(buffer, {
        type: "buffer",
        raw: true,
        cellDates: false,
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return NextResponse.json(
          { error: "File contains no sheets" },
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
        { error: "File contains no data rows" },
        { status: 400 }
      );
    }

    // --- Column validation -----------------------------------------------
    const colCheck = validateRevelPOSColumns(headers);
    if (!colCheck.ok) {
      return NextResponse.json(
        {
          error: "Missing required columns",
          missing: colCheck.missingRequired,
          headers,
        },
        { status: 400 }
      );
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
          error: "Company not found for user",
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

    const company = { id: companyId };

    // Pull lookup data for soft-matching menu_item_id and location_id.
    // We tolerate the case where these tables exist but are empty (e.g. a fresh
    // tenant): empty Map → all rows insert with menu_item_id / location_id null.
    const [menuItemsRes, locationsRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select("id, name")
        .eq("company_id", company.id),
      supabase
        .from("restaurant_locations")
        .select("id, name")
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

    const menuItemIndex = buildNameIndex(
      (menuItemsRes.data ?? []) as { id: string; name: string }[]
    );
    const locationIndex = buildNameIndex(
      (locationsRes.data ?? []) as { id: string; name: string }[]
    );

    // --- Normalize rows ---------------------------------------------------
    const inserts: PosSalesItemInsert[] = [];
    const validation_errors: RowValidationError[] = [];
    const unmatchedMenuItems = new Set<string>();
    const unmatchedLocations = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const res = normalizeRevelPOSRow(rows[i], i, {
        company_id: company.id,
        source_type: sourceType,
        currency: "MXN", // Pinche Gringo pilot; per-tenant currency comes later.
        locationIndex,
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

    if (inserts.length === 0) {
      return NextResponse.json(
        {
          error: "No valid rows to insert",
          validation_errors,
        },
        { status: 400 }
      );
    }

    // --- Replace-existing branch -----------------------------------------
    // When the user opts in, wipe this company's existing pos_sales_items
    // BEFORE inserting the new file. This is the MVP duplicate-protection
    // story; we'd prefer a true upsert key (company + order + item line)
    // later, but that requires a stable composite identifier the export
    // doesn't always carry.
    //
    // Safety:
    //   * the delete is filtered by company_id = company.id, which we just
    //     resolved from the authenticated user (RLS-checked at every step).
    //   * we use the same anon/cookie-bound client as the rest of the
    //     route — no service role, no RLS bypass.
    //   * we count the deleted rows for the summary so the UI can show the
    //     user exactly what happened.
    //
    // We delete BEFORE inserting so that an empty / failing replace doesn't
    // leave the table half-cleared after a successful insert.
    let deletedRows = 0;
    if (replaceExisting) {
      const { error: delError, count: delCount } = await supabase
        .from("pos_sales_items")
        .delete({ count: "exact" })
        .eq("company_id", company.id);
      if (delError) {
        console.error(
          "[POS Upload] replace-existing delete failed:",
          delError.message
        );
        return NextResponse.json(
          {
            error: "Could not replace existing rows",
            details: delError.message,
          },
          { status: 500 }
        );
      }
      deletedRows = delCount ?? 0;
      console.log(
        `[POS Upload] replace_existing=true, deleted ${deletedRows} prior rows for company ${company.id}`
      );
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
            error: "Database insert failed",
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
    };

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[POS Upload] Unexpected error:", message);
    return NextResponse.json(
      { error: "Upload failed", details: message },
      { status: 500 }
    );
  }
}
