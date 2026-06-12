// app/api/restaurant/costs/upload/route.ts
//
// Bulk ingredient-cost importer. Accepts a CSV/XLSX of supplier cost
// observations and writes normalized rows into ingredient_cost_entries,
// auto-creating suppliers and (optionally) ingredients, and maintaining
// supplier_ingredients links.
//
// Deterministic. No OCR, no AI. Parsing + normalization live in
// lib/restaurant/cost-import.ts; this route owns auth, DB lookups, and
// the create-or-match logic that needs the database.
//
// Form fields:
//   file                        (required) the CSV/XLSX
//   create_missing_ingredients  "true" to auto-create unknown ingredients
//   default_currency            3-letter code, default "MXN"
//   skip_duplicates             "true" to skip exact-duplicate rows
//
// Exact-duplicate key (when skip_duplicates is on):
//   company_id + ingredient_id + supplier_id + cost_date + quantity
//   + unit + total_cost

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { normalizeUnit } from "@/lib/restaurant/units";
import {
  validateCostImportColumns,
  normalizeCostImportRow,
  buildIngredientCostEntryInsert,
  nameKey,
  type NormalizedCostRow,
  type CostRowError,
  type IngredientCostEntryInsert,
} from "@/lib/restaurant/cost-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INSERT_BATCH_SIZE = 500;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

interface UploadSummary {
  total_rows_in_file: number;
  inserted_rows: number;
  suppliers_created: number;
  ingredients_created: number;
  supplier_links_upserted: number;
  skipped_duplicate_rows: number;
  unmatched_ingredient_rows: number;
  failed_rows: { rowIndex: number; reason: string; ingredient_name?: string }[];
  resolved_columns: Record<string, string>;
  create_missing_ingredients: boolean;
  default_currency: string;
  warning: string;
}

export async function POST(req: NextRequest) {
  try {
    // --- Auth + company ---------------------------------------------------
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    // --- Form fields ------------------------------------------------------
    const formData = await req.formData();
    const file = formData.get("file");
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

    const truthy = (v: FormDataEntryValue | null) =>
      v === "true" || v === "1" || v === "on";
    const createMissingIngredients = truthy(
      formData.get("create_missing_ingredients")
    );
    const skipDuplicates = truthy(formData.get("skip_duplicates"));
    const defaultCurrencyRaw = formData.get("default_currency");
    const defaultCurrency =
      typeof defaultCurrencyRaw === "string" &&
      /^[A-Za-z]{3}$/.test(defaultCurrencyRaw)
        ? defaultCurrencyRaw.toUpperCase()
        : "MXN";

    // --- Parse file -------------------------------------------------------
    const isCSV = file.name.toLowerCase().endsWith(".csv");
    const buffer = Buffer.from(await file.arrayBuffer());
    let headers: string[] = [];
    let rawRows: Record<string, unknown>[] = [];

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
      rawRows = lines.slice(1).map((line) => {
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
      rawRows = XLSX.utils.sheet_to_json(ws, {
        raw: true,
        defval: "",
      }) as Record<string, unknown>[];
      if (rawRows.length > 0) headers = Object.keys(rawRows[0]);
    }

    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: "File contains no data rows" },
        { status: 400 }
      );
    }

    // --- Validate columns -------------------------------------------------
    const colCheck = validateCostImportColumns(headers);
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

    // --- Normalize all rows (shape only — no DB yet) ----------------------
    const normalized: NormalizedCostRow[] = [];
    const failed: CostRowError[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const res = normalizeCostImportRow(
        rawRows[i],
        i,
        colCheck.resolved,
        defaultCurrency
      );
      if (res.ok) normalized.push(res.value);
      else failed.push(res.error);
    }

    // --- Load existing suppliers + ingredients ---------------------------
    const [suppliersRes, ingredientsRes] = await Promise.all([
      supabase.from("suppliers").select("id, name").eq("company_id", companyId),
      supabase
        .from("ingredients")
        .select("id, name, default_unit")
        .eq("company_id", companyId),
    ]);
    if (suppliersRes.error) {
      console.error("[costs/upload suppliers]", suppliersRes.error.message);
      return NextResponse.json(
        {
          error: "Could not load suppliers",
          details: suppliersRes.error.message,
        },
        { status: 500 }
      );
    }
    if (ingredientsRes.error) {
      console.error("[costs/upload ingredients]", ingredientsRes.error.message);
      return NextResponse.json(
        {
          error: "Could not load ingredients",
          details: ingredientsRes.error.message,
        },
        { status: 500 }
      );
    }

    const supplierIdByName = new Map<string, string>();
    for (const s of (suppliersRes.data ?? []) as {
      id: string;
      name: string;
    }[]) {
      if (s.name) supplierIdByName.set(nameKey(s.name), s.id);
    }
    const ingredientByName = new Map<
      string,
      { id: string; default_unit: string | null }
    >();
    for (const ing of (ingredientsRes.data ?? []) as {
      id: string;
      name: string;
      default_unit: string | null;
    }[]) {
      if (ing.name)
        ingredientByName.set(nameKey(ing.name), {
          id: ing.id,
          default_unit: ing.default_unit,
        });
    }

    // --- Create missing suppliers ----------------------------------------
    // The suppliers table uses a `status` column (default 'active'), NOT
    // `is_active`. We set status explicitly to satisfy the milestone's
    // "supplier status should be active" requirement and to be robust if
    // the column has no default.
    //
    // When a create fails we remember the exact Postgres message keyed by
    // the supplier's normalized name, so each affected row reports the
    // real cause instead of a generic "could not be resolved".
    let suppliersCreated = 0;
    const supplierCreateErrors = new Map<string, string>(); // key → pg message
    const distinctSupplierNames = new Map<string, string>(); // key → display name
    for (const r of normalized)
      distinctSupplierNames.set(nameKey(r.supplier_name), r.supplier_name);
    for (const [key, displayName] of distinctSupplierNames) {
      if (supplierIdByName.has(key)) continue;
      const { data, error } = await supabase
        .from("suppliers")
        .insert({ company_id: companyId, name: displayName, status: "active" })
        .select("id")
        .single();
      if (error || !data) {
        const msg = error?.message ?? "insert returned no row";
        console.error("[costs/upload supplier create]", msg);
        // Surface, but don't abort the whole import — rows for this
        // supplier will fail individually with the exact reason.
        supplierCreateErrors.set(key, msg);
        continue;
      }
      supplierIdByName.set(key, data.id);
      suppliersCreated++;
    }

    // --- Create missing ingredients (only when requested) ----------------
    let ingredientsCreated = 0;
    if (createMissingIngredients) {
      const distinctIngredients = new Map<string, NormalizedCostRow>();
      for (const r of normalized) {
        const key = nameKey(r.ingredient_name);
        if (!ingredientByName.has(key) && !distinctIngredients.has(key)) {
          distinctIngredients.set(key, r);
        }
      }
      for (const [key, sampleRow] of distinctIngredients) {
        // default_unit = normalized uploaded unit when recognisable,
        // else the raw uploaded unit (so same-unit conversion still works).
        const defaultUnit = normalizeUnit(sampleRow.unit) ?? sampleRow.unit;
        const { data, error } = await supabase
          .from("ingredients")
          .insert({
            company_id: companyId,
            name: sampleRow.ingredient_name,
            category: null,
            default_unit: defaultUnit,
            current_unit_cost: 0,
            currency: sampleRow.currency,
          })
          .select("id, default_unit")
          .single();
        if (error || !data) {
          console.error("[costs/upload ingredient create]", error?.message);
          continue;
        }
        ingredientByName.set(key, {
          id: data.id,
          default_unit: data.default_unit,
        });
        ingredientsCreated++;
      }
    }

    // --- Build cost-entry inserts + supplier_ingredients merges ----------
    const inserts: IngredientCostEntryInsert[] = [];
    let unmatchedIngredientRows = 0;

    // (supplier_id|ingredient_id) → merged item name / sku to upsert.
    const linkMerges = new Map<
      string,
      {
        supplier_id: string;
        ingredient_id: string;
        supplier_item_name: string | null;
        supplier_sku: string | null;
      }
    >();

    for (const r of normalized) {
      const supplierId = supplierIdByName.get(nameKey(r.supplier_name)) ?? null;
      const ingredient = ingredientByName.get(nameKey(r.ingredient_name));

      if (!ingredient) {
        unmatchedIngredientRows++;
        failed.push({
          rowIndex: r.rowIndex,
          reason: createMissingIngredients
            ? "Ingredient could not be created"
            : "Unmatched ingredient (enable 'Create missing ingredients' to import)",
          ingredient_name: r.ingredient_name,
        });
        continue;
      }

      if (!supplierId) {
        const pgMessage = supplierCreateErrors.get(nameKey(r.supplier_name));
        failed.push({
          rowIndex: r.rowIndex,
          reason: pgMessage
            ? `Supplier "${r.supplier_name}" could not be created: ${pgMessage}`
            : `Supplier "${r.supplier_name}" could not be resolved or created`,
          ingredient_name: r.ingredient_name,
        });
        continue;
      }

      const built = buildIngredientCostEntryInsert({
        companyId,
        ingredientId: ingredient.id,
        ingredientDefaultUnit: ingredient.default_unit,
        supplierId,
        row: r,
      });
      if (!built.ok) {
        failed.push({
          rowIndex: r.rowIndex,
          reason: built.reason,
          ingredient_name: r.ingredient_name,
        });
        continue;
      }
      inserts.push(built.insert);

      // Accumulate supplier_ingredients link. Last non-empty value wins
      // across rows; we merge with existing DB rows further below.
      if (r.supplier_item_name || r.supplier_sku) {
        const k = `${supplierId}|${ingredient.id}`;
        const prev = linkMerges.get(k);
        linkMerges.set(k, {
          supplier_id: supplierId,
          ingredient_id: ingredient.id,
          supplier_item_name:
            r.supplier_item_name ?? prev?.supplier_item_name ?? null,
          supplier_sku: r.supplier_sku ?? prev?.supplier_sku ?? null,
        });
      }
    }

    // --- Optional exact-duplicate skip -----------------------------------
    let skippedDuplicates = 0;
    let toInsert = inserts;
    if (skipDuplicates && inserts.length > 0) {
      // Pull existing entries for the affected ingredients and build a
      // dedupe key set. Scope the read to just the ingredient ids in this
      // file to keep the query small.
      const ingredientIds = Array.from(
        new Set(inserts.map((i) => i.ingredient_id))
      );
      const { data: existing, error: existingErr } = await supabase
        .from("ingredient_cost_entries")
        .select(
          "ingredient_id, supplier_id, cost_date, quantity, unit, total_cost"
        )
        .eq("company_id", companyId)
        .in("ingredient_id", ingredientIds);
      if (existingErr) {
        console.error("[costs/upload dedupe read]", existingErr.message);
      } else {
        const seen = new Set<string>();
        const dupKey = (e: {
          ingredient_id: string;
          supplier_id: string | null;
          cost_date: string;
          quantity: number;
          unit: string;
          total_cost: number;
        }) =>
          [
            e.ingredient_id,
            e.supplier_id ?? "null",
            e.cost_date,
            e.quantity,
            e.unit,
            e.total_cost,
          ].join("|");
        for (const e of (existing ?? []) as Parameters<typeof dupKey>[0][]) {
          seen.add(dupKey(e));
        }
        toInsert = inserts.filter((ins) => {
          const key = dupKey(ins);
          if (seen.has(key)) {
            skippedDuplicates++;
            return false;
          }
          // Also dedupe within the file itself.
          seen.add(key);
          return true;
        });
      }
    }

    // --- Insert cost entries (batched) -----------------------------------
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH_SIZE) {
      const batch = toInsert.slice(i, i + INSERT_BATCH_SIZE);
      const { error: insErr, count } = await supabase
        .from("ingredient_cost_entries")
        .insert(batch, { count: "exact" });
      if (insErr) {
        console.error("[costs/upload insert]", insErr.message);
        return NextResponse.json(
          {
            error: "Database insert failed",
            details: insErr.message,
            inserted_before_failure: inserted,
          },
          { status: 500 }
        );
      }
      inserted += count ?? batch.length;
    }

    // --- Upsert supplier_ingredients -------------------------------------
    // Merge with existing rows so we never overwrite a non-null
    // supplier_item_name / supplier_sku with an empty value.
    let linksUpserted = 0;
    if (linkMerges.size > 0) {
      const pairs = Array.from(linkMerges.values());
      const supplierIds = Array.from(new Set(pairs.map((p) => p.supplier_id)));
      const ingredientIds = Array.from(
        new Set(pairs.map((p) => p.ingredient_id))
      );
      const { data: existingLinks } = await supabase
        .from("supplier_ingredients")
        .select("supplier_id, ingredient_id, supplier_item_name, supplier_sku")
        .eq("company_id", companyId)
        .in("supplier_id", supplierIds)
        .in("ingredient_id", ingredientIds);

      const existingByPair = new Map<
        string,
        { supplier_item_name: string | null; supplier_sku: string | null }
      >();
      for (const l of (existingLinks ?? []) as {
        supplier_id: string;
        ingredient_id: string;
        supplier_item_name: string | null;
        supplier_sku: string | null;
      }[]) {
        existingByPair.set(`${l.supplier_id}|${l.ingredient_id}`, {
          supplier_item_name: l.supplier_item_name,
          supplier_sku: l.supplier_sku,
        });
      }

      const upsertPayload = pairs.map((p) => {
        const prev = existingByPair.get(`${p.supplier_id}|${p.ingredient_id}`);
        return {
          company_id: companyId,
          supplier_id: p.supplier_id,
          ingredient_id: p.ingredient_id,
          // Prefer the incoming value, but never clobber an existing
          // non-null with null.
          supplier_item_name:
            p.supplier_item_name ?? prev?.supplier_item_name ?? null,
          supplier_sku: p.supplier_sku ?? prev?.supplier_sku ?? null,
        };
      });

      const { error: linkErr, count } = await supabase
        .from("supplier_ingredients")
        .upsert(upsertPayload, {
          onConflict: "company_id,supplier_id,ingredient_id",
          count: "exact",
        });
      if (linkErr) {
        // Non-fatal: cost entries are already in. Report but don't 500.
        console.error("[costs/upload supplier_ingredients]", linkErr.message);
      } else {
        linksUpserted = count ?? upsertPayload.length;
      }
    }

    const summary: UploadSummary = {
      total_rows_in_file: rawRows.length,
      inserted_rows: inserted,
      suppliers_created: suppliersCreated,
      ingredients_created: ingredientsCreated,
      supplier_links_upserted: linksUpserted,
      skipped_duplicate_rows: skippedDuplicates,
      unmatched_ingredient_rows: unmatchedIngredientRows,
      failed_rows: failed.sort((a, b) => a.rowIndex - b.rowIndex),
      resolved_columns: colCheck.resolved,
      create_missing_ingredients: createMissingIngredients,
      default_currency: defaultCurrency,
      warning:
        "Uploading the same file twice will create duplicate cost entries unless 'Skip exact duplicate rows' is enabled.",
    };

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[costs/upload] Unexpected error:", message);
    return NextResponse.json(
      { error: "Upload failed", details: message },
      { status: 500 }
    );
  }
}
