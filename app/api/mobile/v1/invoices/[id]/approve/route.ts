// app/api/mobile/v1/invoices/[id]/approve/route.ts
//
// POST: a person taps «Aprobar» on a pending invoice. The lines they could see
// and that are ready (matched, with a price and a quantity) are approved, then
// the invoice is posted by the SAME function the web approve route uses
// (approveInvoice): incomplete or unmatched lines are skipped and reported,
// never turned into a $0 cost. prices.edit, like the web.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { approveInvoice } from "@/lib/restaurant/invoices/approve-invoice";
import { approveReadyLines } from "@/lib/restaurant/mobile-manager/costos";
import { UUID_RE, mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authManager(request, "prices.edit");
  if (!auth.ok) return auth.response;
  const dict = getDictionary(auth.lang);
  if (!UUID_RE.test(id)) {
    return mobileJson({ error: dict.kitchen.api.managerInvoiceNotFound }, 404);
  }
  try {
    await approveReadyLines(auth.supabase, auth.companyId, id);
    const res = await approveInvoice({
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
      invoiceId: id,
      a: dict.costs.api,
    });
    // Same body and status as the web route, plus the no-store header.
    return mobileJson(await res.json(), res.status);
  } catch (err) {
    console.error(
      "[mobile-invoice-approve] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson(
      { error: dict.kitchen.api.managerInvoiceActionFailed },
      500
    );
  }
}
