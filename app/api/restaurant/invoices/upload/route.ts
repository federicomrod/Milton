// app/api/restaurant/invoices/upload/route.ts
//
// POST /api/restaurant/invoices/upload
//
// Accepts a CSV/XLSX of supplier invoice lines. Each row is a single line on
// some supplier invoice. We group rows by (supplier_name, invoice_number)
// and create one supplier_invoices header per group + a supplier_invoice_lines
// row per file row.
//
// Lines are matched against the ingredient catalog (and the
// supplier_ingredients SKU/item-name links) where possible — see
// lib/restaurant/invoice-import.ts for the matching rules. Unmatched lines
// land in `match_status='unmatched'` for the human reviewer.
//
// IMPORTANT: this route does NOT write to ingredient_cost_entries. That
// happens only when the user runs the /approve route on a needs_review
// invoice.

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  matchIngredientForLine,
  nameKey,
  normalizeInvoiceImportRow,
  validateInvoiceImportColumns,
  type IngredientCatalogEntry,
  type NormalizedInvoiceRow,
  type SupplierIngredientLink,
} from "@/lib/restaurant/invoice-import";
import type { InvoiceLineMatchStatus } from "@/types/supplier-invoices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

interface UploadSummary {
  total_rows_in_file: number;
  invoices_created: number;
  lines_inserted: number;
  suppliers_created: number;
  auto_matched_lines: number;
  unmatched_lines: number;
  failed_rows: { rowIndex: number; reason: string; description?: string }[];
  resolved_columns: Record<string, string>;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId, userId } = auth;

    // --- Form parsing ----------------------------------------------------
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

    const defaultCurrencyRaw = formData.get("default_currency");
    const defaultCurrency =
      typeof defaultCurrencyRaw === "string" &&
      /^[A-Za-z]{3}$/.test(defaultCurrencyRaw)
        ? defaultCurrencyRaw.toUpperCase()
        : "MXN";

    // --- Parse file ------------------------------------------------------
    const isCSV = file.name.toLowerCase().endsWith(".csv");
    const fileBuf = Buffer.from(await file.arrayBuffer());
    let headers: string[] = [];
    let rawRows: Record<string, unknown>[] = [];

    if (isCSV) {
      const text = fileBuf.toString("utf-8");
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
      const workbook = XLSX.read(fileBuf, {
        type: "buffer",
        raw: true,
        cellDates: false,
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return NextResponse.json(
          { error: "Workbook has no sheets" },
          { status: 400 }
        );
      }
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: true,
      }) as Record<string, unknown>[];
      rawRows = json;
      headers = Object.keys(json[0] ?? {});
    }

    // --- Validate columns ------------------------------------------------
    const colCheck = validateInvoiceImportColumns(headers);
    if (!colCheck.ok) {
      return NextResponse.json(
        {
          error: `Missing required columns: ${colCheck.missingRequired.join(", ")}`,
          missing_columns: colCheck.missingRequired,
          resolved_columns: colCheck.resolved,
        },
        { status: 400 }
      );
    }
    const resolved = colCheck.resolved;

    // --- Normalize rows --------------------------------------------------
    const normalized: NormalizedInvoiceRow[] = [];
    const failed: UploadSummary["failed_rows"] = [];
    rawRows.forEach((row, idx) => {
      const result = normalizeInvoiceImportRow(
        row,
        idx + 2, // 1-based, +1 for header row
        resolved,
        defaultCurrency
      );
      if (result.ok) normalized.push(result.value);
      else
        failed.push({
          rowIndex: result.error.rowIndex,
          reason: result.error.reason,
          description: result.error.description,
        });
    });

    if (normalized.length === 0) {
      return NextResponse.json(
        {
          error: "No valid rows in file",
          failed_rows: failed,
          resolved_columns: resolved,
        },
        { status: 400 }
      );
    }

    // --- Resolve suppliers (lookup, then autocreate) ---------------------
    const { data: existingSuppliers } = await supabase
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId);
    const supplierIdByName = new Map<string, string>();
    for (const s of (existingSuppliers ?? []) as {
      id: string;
      name: string;
    }[]) {
      supplierIdByName.set(nameKey(s.name), s.id);
    }

    const distinctSupplierNames = new Map<string, string>();
    for (const r of normalized) {
      distinctSupplierNames.set(nameKey(r.supplier_name), r.supplier_name);
    }
    let suppliersCreated = 0;
    for (const [key, display] of distinctSupplierNames) {
      if (supplierIdByName.has(key)) continue;
      const { data: created, error: createErr } = await supabase
        .from("suppliers")
        .insert({ company_id: companyId, name: display, status: "active" })
        .select("id")
        .single();
      if (createErr || !created) {
        console.error("[invoices/upload supplier create]", createErr?.message);
        continue;
      }
      supplierIdByName.set(key, (created as { id: string }).id);
      suppliersCreated++;
    }

    // --- Ingredient catalog + supplier links (for matching) --------------
    const { data: catalogRows } = await supabase
      .from("ingredients")
      .select("id, name, default_unit")
      .eq("company_id", companyId);
    const ingredientCatalog: IngredientCatalogEntry[] = (catalogRows ??
      []) as IngredientCatalogEntry[];

    const { data: linkRows } = await supabase
      .from("supplier_ingredients")
      .select("supplier_id, ingredient_id, supplier_item_name, supplier_sku")
      .eq("company_id", companyId);
    const supplierLinks: SupplierIngredientLink[] = (linkRows ??
      []) as SupplierIngredientLink[];

    // --- Group rows into invoices ----------------------------------------
    // Group key: (supplier_id, invoice_number, invoice_date). All rows for
    // the same invoice should share the same number and date.
    type Group = {
      supplierName: string;
      supplierId: string | null;
      invoice_number: string;
      invoice_date: string;
      due_date: string | null;
      currency: string;
      rows: NormalizedInvoiceRow[];
    };
    const groups = new Map<string, Group>();
    for (const r of normalized) {
      const supplierKey = nameKey(r.supplier_name);
      const supplierId = supplierIdByName.get(supplierKey) ?? null;
      const groupKey = `${supplierId ?? supplierKey}::${r.invoice_number.toLowerCase()}::${r.invoice_date}`;
      let g = groups.get(groupKey);
      if (!g) {
        g = {
          supplierName: r.supplier_name,
          supplierId,
          invoice_number: r.invoice_number,
          invoice_date: r.invoice_date,
          due_date: r.due_date,
          currency: r.currency,
          rows: [],
        };
        groups.set(groupKey, g);
      }
      g.rows.push(r);
    }

    // --- Persist invoices + lines ----------------------------------------
    const result: UploadSummary = {
      total_rows_in_file: rawRows.length,
      invoices_created: 0,
      lines_inserted: 0,
      suppliers_created: suppliersCreated,
      auto_matched_lines: 0,
      unmatched_lines: 0,
      failed_rows: failed,
      resolved_columns: resolved,
    };

    const sourceType = isCSV ? "csv" : "xlsx";

    for (const g of groups.values()) {
      // Totals from line_total sums (subtotal). Tax is sum of optional
      // per-line tax_amount when present.
      let subtotal = 0;
      let taxSum = 0;
      for (const r of g.rows) {
        subtotal += r.line_total;
        if (r.tax_amount !== null) taxSum += r.tax_amount;
      }
      const total = subtotal + taxSum;

      const { data: inserted, error: invErr } = await supabase
        .from("supplier_invoices")
        .insert({
          company_id: companyId,
          supplier_id: g.supplierId,
          invoice_number: g.invoice_number,
          invoice_date: g.invoice_date,
          due_date: g.due_date,
          currency: g.currency,
          subtotal,
          tax_amount: taxSum > 0 ? taxSum : null,
          total_amount: total,
          status: "needs_review",
          source_type: sourceType,
          original_file_name: file.name,
          created_by_user_id: userId,
        })
        .select("id")
        .single();
      if (invErr || !inserted) {
        console.error("[invoices/upload invoice insert]", invErr?.message);
        for (const r of g.rows) {
          result.failed_rows.push({
            rowIndex: r.rowIndex,
            reason: `Invoice insert failed: ${invErr?.message ?? "unknown"}`,
            description: r.description,
          });
        }
        continue;
      }
      const invoiceId = (inserted as { id: string }).id;
      result.invoices_created++;

      // Build line inserts with attempted matches.
      const lineInserts = g.rows.map((r) => {
        const match = matchIngredientForLine(
          {
            ingredient_name: r.ingredient_name,
            supplier_item_name: r.supplier_item_name,
            supplier_sku: r.supplier_sku,
            supplier_id: g.supplierId,
          },
          ingredientCatalog,
          supplierLinks
        );
        const matchStatus: InvoiceLineMatchStatus = match
          ? "auto_matched"
          : "unmatched";
        if (match) result.auto_matched_lines++;
        else result.unmatched_lines++;
        return {
          company_id: companyId,
          invoice_id: invoiceId,
          supplier_id: g.supplierId,
          ingredient_id: match?.ingredient_id ?? null,
          supplier_item_name: r.supplier_item_name,
          supplier_sku: r.supplier_sku,
          description: r.description,
          quantity: r.quantity,
          unit: r.unit,
          unit_cost: r.unit_cost,
          line_total: r.line_total,
          tax_amount: r.tax_amount,
          match_status: matchStatus,
          review_status: "pending" as const,
          notes: r.notes,
        };
      });

      const { error: linesErr, count } = await supabase
        .from("supplier_invoice_lines")
        .insert(lineInserts, { count: "exact" });
      if (linesErr) {
        console.error("[invoices/upload line insert]", linesErr.message);
        // Surface but don't abort other invoices.
        for (const r of g.rows) {
          result.failed_rows.push({
            rowIndex: r.rowIndex,
            reason: `Line insert failed: ${linesErr.message}`,
            description: r.description,
          });
        }
        continue;
      }
      result.lines_inserted += count ?? lineInserts.length;

      // Audit event: uploaded.
      await supabase.from("invoice_events").insert({
        company_id: companyId,
        invoice_id: invoiceId,
        event_type: "uploaded",
        user_id: userId,
        metadata: {
          source: sourceType,
          file_name: file.name,
          row_count: g.rows.length,
        },
      });
    }

    return NextResponse.json({ summary: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    console.error("[invoices/upload] crash:", msg);
    return NextResponse.json(
      { error: "Upload failed", details: msg },
      { status: 500 }
    );
  }
}
