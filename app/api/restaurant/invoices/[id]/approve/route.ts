// app/api/restaurant/invoices/[id]/approve/route.ts
//
// POST /api/restaurant/invoices/:id/approve
//
// Posts an invoice: walks every approved+matched line and inserts a
// corresponding ingredient_cost_entries row (source_type='invoice_line',
// source_id=supplier_invoice_lines.id), then flips the invoice to
// status='posted'. Lines that aren't approved+matched are skipped and
// returned in `skipped_lines`.
//
// Conditions:
//   * Invoice must belong to the caller's company.
//   * Invoice status must be `draft`, `needs_review`, or `approved`.
//     ('posted' is rejected: an invoice can't be posted twice.)
//   * At least one line must be approved+matched. Otherwise → 400.
//   * For every approved+matched line, the line's unit must be convertible
//     to the matched ingredient's default_unit. Lines where conversion
//     fails are skipped (the line's review_status is left alone) and
//     returned with a reason. The invoice still posts for the rest.
//
// On success, `agent_action`-style audit events are inserted:
//   - one `approved` event when the header transitions
//   - one `posted` event after cost entries are written

import { apiDictionary } from "@/lib/restaurant/api-lang";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { approveInvoice } from "@/lib/restaurant/invoices/approve-invoice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "prices.edit");
  if (denied) return denied;
  const a = (await apiDictionary()).costs.api;
  return approveInvoice({
    supabase: auth.supabase,
    companyId: auth.companyId,
    userId: auth.userId,
    invoiceId,
    a,
  });
}
