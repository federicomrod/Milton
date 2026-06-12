// types/supplier-invoices.ts
//
// Shared types for the supplier invoice ingestion module. Mirrors the schema
// defined in supabase/migrations/010_supplier_invoice_ingestion.sql.
//
// Posting (i.e. writing rows into ingredient_cost_entries) happens ONLY when
// an invoice transitions to status='posted' via the /approve route. Other
// statuses are intermediate review states.

// ---------------------------------------------------------------------------
// Enums (mirror the SQL CHECK constraints)
// ---------------------------------------------------------------------------

export type InvoiceStatus =
  | "draft"
  | "needs_review"
  | "approved"
  | "rejected"
  | "posted";

export type InvoiceSourceType =
  | "manual"
  | "csv"
  | "xlsx"
  | "pdf"
  | "image"
  | "email"
  | "api";

export type InvoiceLineMatchStatus =
  | "unmatched"
  | "matched"
  | "auto_matched"
  | "ignored";

export type InvoiceLineReviewStatus = "pending" | "approved" | "rejected";

export type InvoiceEventType =
  | "created"
  | "uploaded"
  | "line_matched"
  | "line_approved"
  | "approved"
  | "posted"
  | "rejected"
  | "note_added";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface SupplierInvoice {
  id: string;
  company_id: string;
  supplier_id: string | null;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  currency: string;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  status: InvoiceStatus;
  source_type: InvoiceSourceType;
  original_file_name: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierInvoiceLine {
  id: string;
  company_id: string;
  invoice_id: string;
  supplier_id: string | null;
  ingredient_id: string | null;
  supplier_item_name: string | null;
  supplier_sku: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  line_total: number;
  tax_amount: number | null;
  normalized_unit: string | null;
  normalized_unit_cost: number | null;
  match_status: InvoiceLineMatchStatus;
  review_status: InvoiceLineReviewStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceEvent {
  id: string;
  company_id: string;
  invoice_id: string;
  event_type: InvoiceEventType;
  user_id: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Runtime arrays (parallel to the SQL CHECK arrays — handy for guards)
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
  "posted",
] as const;

export const INVOICE_SOURCE_TYPES: readonly InvoiceSourceType[] = [
  "manual",
  "csv",
  "xlsx",
  "pdf",
  "image",
  "email",
  "api",
] as const;

export const INVOICE_LINE_MATCH_STATUSES: readonly InvoiceLineMatchStatus[] = [
  "unmatched",
  "matched",
  "auto_matched",
  "ignored",
] as const;

export const INVOICE_LINE_REVIEW_STATUSES: readonly InvoiceLineReviewStatus[] =
  ["pending", "approved", "rejected"] as const;

export const INVOICE_EVENT_TYPES: readonly InvoiceEventType[] = [
  "created",
  "uploaded",
  "line_matched",
  "line_approved",
  "approved",
  "posted",
  "rejected",
  "note_added",
] as const;

// ---------------------------------------------------------------------------
// Cheap runtime guards (API input validation)
// ---------------------------------------------------------------------------

export function isInvoiceStatus(v: unknown): v is InvoiceStatus {
  return (
    typeof v === "string" && (INVOICE_STATUSES as readonly string[]).includes(v)
  );
}

export function isInvoiceSourceType(v: unknown): v is InvoiceSourceType {
  return (
    typeof v === "string" &&
    (INVOICE_SOURCE_TYPES as readonly string[]).includes(v)
  );
}

export function isInvoiceLineMatchStatus(
  v: unknown
): v is InvoiceLineMatchStatus {
  return (
    typeof v === "string" &&
    (INVOICE_LINE_MATCH_STATUSES as readonly string[]).includes(v)
  );
}

export function isInvoiceLineReviewStatus(
  v: unknown
): v is InvoiceLineReviewStatus {
  return (
    typeof v === "string" &&
    (INVOICE_LINE_REVIEW_STATUSES as readonly string[]).includes(v)
  );
}
