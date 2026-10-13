import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { DATE_RE } from "@/lib/restaurant/odoo/sync-window";
import {
  loadRecipeCostingWorkspace,
  parseCostingView,
} from "@/lib/restaurant/recipe-costing/workspace-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const startParam = url.searchParams.get("start_date");
  const endParam = url.searchParams.get("end_date");
  if ((startParam && !endParam) || (!startParam && endParam)) {
    return NextResponse.json(
      {
        error: "start_date y end_date deben ir juntas, con formato YYYY-MM-DD.",
      },
      { status: 400 }
    );
  }
  if (startParam && endParam) {
    if (!DATE_RE.test(startParam) || !DATE_RE.test(endParam)) {
      return NextResponse.json(
        {
          error:
            "start_date y end_date deben ir juntas, con formato YYYY-MM-DD.",
        },
        { status: 400 }
      );
    }
  }

  const productRaw = url.searchParams.get("odoo_product_id");
  const selected =
    productRaw && Number.isInteger(Number(productRaw))
      ? Number(productRaw)
      : null;

  const loaded = await loadRecipeCostingWorkspace(auth.supabase, {
    companyId: auth.companyId,
    userId: auth.userId,
    view: parseCostingView(url.searchParams.get("vista")),
    locationId: url.searchParams.get("location_id"),
    startDate: startParam,
    endDate: endParam,
    selectedOdooProductId: selected,
    editorOnly: url.searchParams.get("editor_only") === "1",
  });
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }
  return NextResponse.json(loaded.workspace);
}
