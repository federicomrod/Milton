// GET /api/analytics/b2b-saas/cash-flow?from_date=...&to_date=...&period=...
// Same behaviour as fitness-studio: server-side fetch and return. Delegates to shared logic.
import { NextRequest } from "next/server";
import { GET as fitnessCashFlowGet } from "@/app/api/analytics/fitness-studio/cash-flow/route";

export async function GET(req: NextRequest) {
  return fitnessCashFlowGet(req);
}
