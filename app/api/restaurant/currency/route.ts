// GET /api/restaurant/currency
//
// Returns the company-level currency used as the default on every
// create/upload path and as the cockpit / Ask Milton display currency.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const currency = await resolveCompanyCurrency(auth.supabase, auth.companyId);
  return NextResponse.json({ currency });
}
