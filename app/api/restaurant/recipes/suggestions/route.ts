// POST /api/restaurant/recipes/suggestions
//
// Run AI recipe suggestions for the top N POS products (or one product)
// against an uploaded COSTO RESTAURANTE workbook. Ranking stays on the
// server. Company comes from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolveRestaurantCockpitLanguage } from "@/lib/restaurant/language";
import { DATE_RE } from "@/lib/restaurant/odoo/sync-window";
import { runRecipeSuggestionsForCompany } from "@/lib/restaurant/recipe-suggestion-server";
import { createDefaultWorkbookAi } from "@/lib/restaurant/cost-workbook";
import { isWorkbookLimitError } from "@/lib/restaurant/cost-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Sube el Excel de recetas (file)." },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "El archivo pesa más de 15 MB." },
      { status: 400 }
    );
  }

  const limitRaw = form.get("limit");
  const limit =
    typeof limitRaw === "string" && limitRaw.trim() ? Number(limitRaw) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return NextResponse.json(
      { error: "limit tiene que ser un entero entre 1 y 200." },
      { status: 400 }
    );
  }

  const productRaw = form.get("odoo_product_id");
  let odooProductId: number | undefined;
  if (typeof productRaw === "string" && productRaw.trim()) {
    const parsed = Number(productRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "odoo_product_id tiene que ser un entero positivo." },
        { status: 400 }
      );
    }
    odooProductId = parsed;
  }

  const startParam =
    typeof form.get("start_date") === "string"
      ? String(form.get("start_date"))
      : null;
  const endParam =
    typeof form.get("end_date") === "string"
      ? String(form.get("end_date"))
      : null;
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
    if (startParam > endParam) {
      return NextResponse.json(
        { error: "start_date debe ser anterior o igual a end_date." },
        { status: 400 }
      );
    }
  }

  const locationId =
    typeof form.get("location_id") === "string" &&
    String(form.get("location_id")).trim()
      ? String(form.get("location_id")).trim()
      : null;

  const lang = resolveRestaurantCockpitLanguage();
  const currency = await resolveCompanyCurrency(auth.supabase, auth.companyId);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await runRecipeSuggestionsForCompany(auth.supabase, {
      companyId: auth.companyId,
      buffer,
      filename: file.name || "recetas.xlsx",
      currency: currency || "USD",
      limit,
      odooProductId,
      locationId,
      startDate: startParam,
      endDate: endParam,
      lang,
      createdBy: auth.userId,
      ai: createDefaultWorkbookAi(),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (isWorkbookLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[recipe-suggestions]", err);
    return NextResponse.json(
      { error: "No pude generar las sugerencias de receta." },
      { status: 500 }
    );
  }
}
