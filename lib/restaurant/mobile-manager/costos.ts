// lib/restaurant/mobile-manager/costos.ts
//
// Costos for the phone: the pending Compras invoices (the web's own pending
// statuses) with their lines, and the two human actions. Nothing is automatic:
// a person taps Aprobar or Rechazar.
//
// Missing prices are never $0: a line without a price says so (`unitCost`
// null) and the Total follows the Compras rule (invoice-list-preview).

import type { SupabaseClient } from "@supabase/supabase-js";
import { PENDING_INVOICE_STATUSES } from "@/lib/restaurant/costs-page-data";
import {
  buildInvoiceLineSummaries,
  INVOICE_LINE_PREVIEW_SELECT,
} from "@/lib/restaurant/invoice-list-preview";
import {
  lineIsIncomplete,
  parseMissing,
  type MissingField,
} from "@/lib/restaurant/invoice-missing";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";

export const MAX_PENDING_INVOICES = 20;
export const MAX_LINES_PER_INVOICE = 40;

export interface PendingInvoiceLine {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  /** null = «Sin precio». */
  unitCost: number | null;
  /** null = «Sin precio» (or «Falta» when only the quantity is missing). */
  lineTotal: number | null;
  missing: MissingField[];
  incomplete: boolean;
  matched: boolean;
}

export interface PendingInvoice {
  id: string;
  supplier: string | null;
  number: string | null;
  date: string;
  status: string;
  /** Telegram / app / photo / upload / manual. */
  source: string;
  /** qty × price of every line, null if any line is incomplete. */
  total: number | null;
  /** At least one line has a price. */
  priced: boolean;
  lineCount: number;
  /** Lines (all of them, not only the listed ones) with no price: «Sin precio». */
  noPriceCount: number;
  lines: PendingInvoiceLine[];
}

export interface CostosPayload {
  currency: string;
  pendingCount: number;
  invoices: PendingInvoice[];
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function loadPendingInvoices(
  supabase: SupabaseClient,
  companyId: string
): Promise<CostosPayload> {
  const currency = await resolveCompanyCurrency(supabase, companyId);
  const [listRes, countRes] = await Promise.all([
    supabase
      .from("supplier_invoices")
      .select(
        "id, supplier_id, invoice_number, invoice_date, currency, status, source_type, created_at"
      )
      .eq("company_id", companyId)
      .in("status", [...PENDING_INVOICE_STATUSES])
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_PENDING_INVOICES),
    supabase
      .from("supplier_invoices")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", [...PENDING_INVOICE_STATUSES]),
  ]);
  if (listRes.error) throw new Error("invoices read failed");
  const rows = (listRes.data ?? []) as Array<{
    id: string;
    supplier_id: string | null;
    invoice_number: string | null;
    invoice_date: string;
    status: string;
    source_type: string;
  }>;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    return { currency, pendingCount: countRes.count ?? 0, invoices: [] };
  }
  const supplierIds = [
    ...new Set(rows.map((r) => r.supplier_id).filter(Boolean)),
  ] as string[];
  const [linesRes, suppliersRes] = await Promise.all([
    supabase
      .from("supplier_invoice_lines")
      .select(
        `${INVOICE_LINE_PREVIEW_SELECT}, supplier_item_name, match_status`
      )
      .eq("company_id", companyId)
      .in("invoice_id", ids),
    supplierIds.length
      ? supabase
          .from("suppliers")
          .select("id, name")
          .eq("company_id", companyId)
          .in("id", supplierIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const lines = (linesRes.data ?? []) as Array<Record<string, unknown>>;
  const supplierName = new Map(
    ((suppliersRes.data ?? []) as { id: string; name: string }[]).map((s) => [
      s.id,
      s.name,
    ])
  );
  const summaries = buildInvoiceLineSummaries(ids, lines as never, new Map());
  const byInvoice = new Map<string, Array<Record<string, unknown>>>();
  for (const l of lines) {
    const id = String(l.invoice_id);
    const list = byInvoice.get(id) ?? [];
    list.push(l);
    byInvoice.set(id, list);
  }
  const invoices: PendingInvoice[] = rows.map((r) => {
    const own = (byInvoice.get(r.id) ?? []).sort((a, b) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    );
    const amounts = summaries.get(r.id)?.amounts ?? {
      total: null,
      priced: false,
    };
    return {
      id: r.id,
      supplier: r.supplier_id
        ? (supplierName.get(r.supplier_id) ?? null)
        : null,
      number: r.invoice_number,
      date: r.invoice_date,
      status: r.status,
      source: r.source_type,
      total: amounts.total,
      priced: amounts.priced,
      lineCount: own.length,
      noPriceCount: own.filter((l) => {
        const c = num(l.unit_cost);
        return c === null || c <= 0;
      }).length,
      lines: own.slice(0, MAX_LINES_PER_INVOICE).map((l) => {
        const cost = num(l.unit_cost);
        const total = num(l.line_total);
        const missing = parseMissing(l.notes);
        return {
          id: String(l.id),
          name:
            String(l.supplier_item_name ?? "").trim() ||
            String(l.description ?? "").trim() ||
            "—",
          quantity: num(l.quantity),
          unit: typeof l.unit === "string" && l.unit ? l.unit : null,
          unitCost: cost !== null && cost > 0 ? cost : null,
          lineTotal:
            total !== null && total > 0 && !missing.includes("quantity")
              ? total
              : null,
          missing,
          incomplete: lineIsIncomplete(l),
          matched:
            l.match_status === "matched" || l.match_status === "auto_matched",
        };
      }),
    };
  });
  return {
    currency,
    pendingCount: countRes.count ?? invoices.length,
    invoices,
  };
}

/**
 * Marks the lines a person can approve as they are (matched, complete) as
 * approved: the tap on «Aprobar» is that person's decision on what they saw.
 * Unmatched or incomplete lines stay pending and are reported by the posting.
 */
export async function approveReadyLines(
  supabase: SupabaseClient,
  companyId: string,
  invoiceId: string
): Promise<void> {
  const { data } = await supabase
    .from("supplier_invoice_lines")
    .select("id, unit_cost, line_total, notes, match_status, review_status")
    .eq("company_id", companyId)
    .eq("invoice_id", invoiceId);
  const ready = ((data ?? []) as Array<Record<string, unknown>>).filter(
    (l) =>
      l.review_status === "pending" &&
      (l.match_status === "matched" || l.match_status === "auto_matched") &&
      !lineIsIncomplete(l)
  );
  for (const l of ready) {
    await supabase
      .from("supplier_invoice_lines")
      .update({ review_status: "approved" })
      .eq("company_id", companyId)
      .eq("invoice_id", invoiceId)
      .eq("id", String(l.id));
  }
}

export type RejectResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "failed" };

/**
 * Rejects a pending invoice with the existing `rejected` status. Nothing is
 * posted and no cost entry is written.
 */
export async function rejectInvoice(args: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  invoiceId: string;
}): Promise<RejectResult> {
  const { supabase, companyId, userId, invoiceId } = args;
  const { data: inv, error } = await supabase
    .from("supplier_invoices")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) return { ok: false, reason: "failed" };
  if (!inv) return { ok: false, reason: "not_found" };
  if (
    !(PENDING_INVOICE_STATUSES as readonly string[]).includes(
      (inv as { status: string }).status
    )
  ) {
    return { ok: false, reason: "not_pending" };
  }
  const { error: updErr } = await supabase
    .from("supplier_invoices")
    .update({ status: "rejected" })
    .eq("company_id", companyId)
    .eq("id", invoiceId);
  if (updErr) return { ok: false, reason: "failed" };
  await supabase.from("invoice_events").insert({
    company_id: companyId,
    invoice_id: invoiceId,
    event_type: "rejected",
    user_id: userId,
    metadata: { via: "mobile" },
  });
  return { ok: true };
}
