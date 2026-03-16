// GET /api/analytics/b2b-saas/financials?from_date=...&to_date=...&chart=...
// Same behaviour as fitness-studio: server-side fetch and return. Delegates to shared logic.
import { NextRequest } from "next/server";
import { GET as fitnessFinancialsGet } from "@/app/api/analytics/fitness-studio/financials/route";

export async function GET(req: NextRequest) {
  return fitnessFinancialsGet(req);
}
