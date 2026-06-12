// app/dashboard/restaurant/invoices/page.tsx
//
// Server entrypoint for the Supplier Invoices module (Milestone 2 / Stage 1).
// Loads the invoice list + the company's ingredient catalog and hands them
// to a client component that owns all interactive bits (upload form, manual
// header creation, review detail panel).

import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import {
  InvoicesPage,
  type InvoiceListItem,
} from "@/components/restaurant/InvoicesPage";

export const dynamic = "force-dynamic";

export default async function SupplierInvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const companyId = user
    ? await resolveCompanyIdForUser(supabase, user.id)
    : null;

  if (!companyId) {
    return (
      <div className="w-full py-8 px-6 lg:px-10">
        <p className="text-sm text-muted-foreground">
          Sign in and pick a company to manage supplier invoices.
        </p>
      </div>
    );
  }

  // Initial list of invoices + line counts (used to render "matched/total"
  // pills without an extra round-trip). Suppliers are also loaded so the
  // manual create form can use a select.
  const [invRes, lineRes, supplierRes, ingRes] = await Promise.all([
    supabase
      .from("supplier_invoices")
      .select(
        "id, company_id, supplier_id, invoice_number, invoice_date, due_date, currency, subtotal, tax_amount, total_amount, status, source_type, original_file_name, notes, created_at, updated_at"
      )
      .eq("company_id", companyId)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("supplier_invoice_lines")
      .select("invoice_id, match_status, review_status")
      .eq("company_id", companyId),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
    supabase
      .from("ingredients")
      .select("id, name, default_unit")
      .eq("company_id", companyId)
      .order("name", { ascending: true }),
  ]);

  if (invRes.error)
    console.error("[invoices page] supplier_invoices:", invRes.error.message);
  if (lineRes.error)
    console.error(
      "[invoices page] supplier_invoice_lines:",
      lineRes.error.message
    );
  if (supplierRes.error)
    console.error("[invoices page] suppliers:", supplierRes.error.message);
  if (ingRes.error)
    console.error("[invoices page] ingredients:", ingRes.error.message);

  const supplierNameById = new Map<string, string>();
  for (const s of (supplierRes.data ?? []) as { id: string; name: string }[]) {
    supplierNameById.set(s.id, s.name);
  }

  type LineCount = {
    total: number;
    matched: number;
    approved: number;
    unmatched: number;
    pending: number;
  };
  const lineCounts = new Map<string, LineCount>();
  for (const row of (invRes.data ?? []) as { id: string }[]) {
    lineCounts.set(row.id, {
      total: 0,
      matched: 0,
      approved: 0,
      unmatched: 0,
      pending: 0,
    });
  }
  type LineLite = {
    invoice_id: string;
    match_status: string;
    review_status: string;
  };
  for (const l of (lineRes.data ?? []) as LineLite[]) {
    const bucket = lineCounts.get(l.invoice_id);
    if (!bucket) continue;
    bucket.total++;
    if (l.match_status === "matched" || l.match_status === "auto_matched") {
      bucket.matched++;
    }
    if (l.match_status === "unmatched") bucket.unmatched++;
    if (l.review_status === "approved") bucket.approved++;
    if (l.review_status === "pending") bucket.pending++;
  }

  const invoices: InvoiceListItem[] = (
    (invRes.data ?? []) as Record<string, unknown>[]
  ).map((raw) => {
    const r = raw as {
      id: string;
      supplier_id: string | null;
      invoice_number: string | null;
      invoice_date: string;
      due_date: string | null;
      currency: string;
      total_amount: number | null;
      status: string;
      source_type: string;
      created_at: string;
    };
    return {
      id: r.id,
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_id
        ? (supplierNameById.get(r.supplier_id) ?? null)
        : null,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      due_date: r.due_date,
      currency: r.currency,
      total_amount: r.total_amount,
      status: r.status,
      source_type: r.source_type,
      created_at: r.created_at,
      line_counts: lineCounts.get(r.id) ?? {
        total: 0,
        matched: 0,
        approved: 0,
        unmatched: 0,
        pending: 0,
      },
    };
  });

  return (
    <InvoicesPage
      initialInvoices={invoices}
      suppliers={(supplierRes.data ?? []) as { id: string; name: string }[]}
      ingredients={
        (ingRes.data ?? []) as {
          id: string;
          name: string;
          default_unit: string | null;
        }[]
      }
    />
  );
}
