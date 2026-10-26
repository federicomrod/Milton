import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { DATE_RE } from "@/lib/restaurant/odoo/sync-window";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
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

  // R1-13: `vistas=resumen,plato,preparaciones` answers several Menú tabs
  // in one request; they share one dish-economics read (the expensive part).
  const vistas = [
    ...new Set(
      (url.searchParams.get("vistas") ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map(parseCostingView)
    ),
  ].slice(0, 3);
  if (vistas.length > 0) {
    const economics = loadDishEconomics(
      auth.companyId,
      startParam,
      endParam,
      url.searchParams.get("location_id")
    );
    const all = await Promise.all(
      vistas.map((view) =>
        loadRecipeCostingWorkspace(auth.supabase, {
          companyId: auth.companyId,
          userId: auth.userId,
          view,
          locationId: url.searchParams.get("location_id"),
          startDate: startParam,
          endDate: endParam,
          selectedOdooProductId: null,
          // Platos with no period opens on Resumen's month: it reads its own
          // economics for that range instead of the shared all-history one.
          economics:
            view === "plato" && !startParam && !endParam
              ? undefined
              : economics,
        })
      )
    );
    const failed = all.find((r) => !r.ok);
    if (failed && !failed.ok) {
      return NextResponse.json({ error: failed.error }, { status: 500 });
    }
    return NextResponse.json(
      Object.fromEntries(
        all.map((r, i) => [vistas[i], r.ok ? r.workspace : null])
      )
    );
  }

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
