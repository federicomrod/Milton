// POST /api/restaurant/recipes/suggestions
//
// Run AI recipe suggestions for the top N POS products (or one product)
// against an uploaded COSTO RESTAURANTE workbook, or against the latest
// live Costos upload already stored on the company. Ranking stays on the
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

function readLimit(raw: unknown): number | { error: string } {
  if (raw == null || raw === "") return 20;
  const limit = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { error: "limit tiene que ser un entero entre 1 y 200." };
  }
  return limit;
}

function readProductId(raw: unknown): number | undefined | { error: string } {
  if (raw == null || raw === "") return undefined;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: "odoo_product_id tiene que ser un entero positivo." };
  }
  return parsed;
}

function readDates(
  startParam: string | null,
  endParam: string | null
): { startDate: string | null; endDate: string | null } | { error: string } {
  if ((startParam && !endParam) || (!startParam && endParam)) {
    return {
      error: "start_date y end_date deben ir juntas, con formato YYYY-MM-DD.",
    };
  }
  if (startParam && endParam) {
    if (!DATE_RE.test(startParam) || !DATE_RE.test(endParam)) {
      return {
        error: "start_date y end_date deben ir juntas, con formato YYYY-MM-DD.",
      };
    }
    if (startParam > endParam) {
      return { error: "start_date debe ser anterior o igual a end_date." };
    }
  }
  return { startDate: startParam, endDate: endParam };
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const contentType = req.headers.get("content-type") ?? "";
  let buffer: Buffer | undefined;
  let filename = "recetas.xlsx";
  let fromLatestUpload = false;
  let limitRaw: unknown;
  let productRaw: unknown;
  let startParam: string | null = null;
  let endParam: string | null = null;
  let locationId: string | null = null;

  if (contentType.includes("application/json")) {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "El cuerpo tiene que ser JSON." },
        { status: 400 }
      );
    }
    fromLatestUpload = body.source === "latest_upload" || body.source == null;
    limitRaw = body.limit;
    productRaw = body.odoo_product_id;
    startParam = typeof body.start_date === "string" ? body.start_date : null;
    endParam = typeof body.end_date === "string" ? body.end_date : null;
    locationId =
      typeof body.location_id === "string" && body.location_id.trim()
        ? body.location_id.trim()
        : null;
  } else {
    const form = await req.formData();
    const file = form.get("file");
    if (file instanceof File) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "El archivo pesa más de 15 MB." },
          { status: 400 }
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name || "recetas.xlsx";
    } else {
      fromLatestUpload = true;
    }
    limitRaw = form.get("limit");
    productRaw = form.get("odoo_product_id");
    startParam =
      typeof form.get("start_date") === "string"
        ? String(form.get("start_date"))
        : null;
    endParam =
      typeof form.get("end_date") === "string"
        ? String(form.get("end_date"))
        : null;
    locationId =
      typeof form.get("location_id") === "string" &&
      String(form.get("location_id")).trim()
        ? String(form.get("location_id")).trim()
        : null;
  }

  const limit = readLimit(limitRaw);
  if (typeof limit !== "number") {
    return NextResponse.json({ error: limit.error }, { status: 400 });
  }
  const odooProductId = readProductId(productRaw);
  if (odooProductId && typeof odooProductId !== "number") {
    return NextResponse.json({ error: odooProductId.error }, { status: 400 });
  }
  const dates = readDates(startParam, endParam);
  if ("error" in dates) {
    return NextResponse.json({ error: dates.error }, { status: 400 });
  }

  const lang = resolveRestaurantCockpitLanguage();
  const currency = await resolveCompanyCurrency(auth.supabase, auth.companyId);

  try {
    const result = await runRecipeSuggestionsForCompany(auth.supabase, {
      companyId: auth.companyId,
      buffer,
      filename,
      fromLatestUpload: !buffer && fromLatestUpload,
      currency: currency || "USD",
      limit,
      odooProductId:
        typeof odooProductId === "number" ? odooProductId : undefined,
      locationId,
      startDate: dates.startDate,
      endDate: dates.endDate,
      lang,
      createdBy: auth.userId,
      ai: createDefaultWorkbookAi(),
    });
    if (!result.ok) {
      const status = /No hay un archivo/.test(result.error) ? 400 : 500;
      return NextResponse.json({ error: result.error }, { status });
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
