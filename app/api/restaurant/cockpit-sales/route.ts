// GET /api/restaurant/cockpit-sales
//
// Explorer rows + heatmap aggregate for the deferred cockpit Sales tab
// and as a fallback the thin Sales route can reuse. Auth + company from
// the session; location is validated against the caller's company.

import { NextRequest, NextResponse } from "next/server";
import { loadSalesExplorerModel } from "@/lib/restaurant/cockpit-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const location = request.nextUrl.searchParams.get("location") ?? undefined;
  const model = await loadSalesExplorerModel(location);
  if (model.mode !== "live") {
    return NextResponse.json(
      { error: model.reason ?? "no_sales" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    rows: model.explorerRows,
    targets: model.targets,
    displayCurrency: model.displayCurrency,
    cockpit: model.cockpit,
  });
}
