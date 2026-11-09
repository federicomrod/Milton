// app/api/mobile/v1/invoices/[id]/reject/route.ts
//
// POST: a person taps «Rechazar» on a pending invoice. It gets the existing
// `rejected` status; nothing is posted. prices.edit, like the web.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { rejectInvoice } from "@/lib/restaurant/mobile-manager/costos";
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
  const d = getDictionary(auth.lang).kitchen.api;
  if (!UUID_RE.test(id)) {
    return mobileJson({ error: d.managerInvoiceNotFound }, 404);
  }
  try {
    const result = await rejectInvoice({
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
      invoiceId: id,
    });
    if (result.ok) return mobileJson({ status: "rejected" });
    if (result.reason === "not_found") {
      return mobileJson({ error: d.managerInvoiceNotFound }, 404);
    }
    if (result.reason === "not_pending") {
      return mobileJson({ error: d.managerInvoiceNotPending }, 409);
    }
    return mobileJson({ error: d.managerInvoiceActionFailed }, 500);
  } catch (err) {
    console.error(
      "[mobile-invoice-reject] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: d.managerInvoiceActionFailed }, 500);
  }
}
