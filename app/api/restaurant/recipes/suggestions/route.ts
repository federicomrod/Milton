// POST /api/restaurant/recipes/suggestions
//
// Body (JSON): { limit?, offset?, odoo_product_id?, start_date?, end_date?,
//               location_id? }
//
// Prepare dish drafts for the top POS products (or one product) from the
// cost file already uploaded with "Subir Excel de costos" — the one upload;
// this route never takes a file. Owner, admin, manager or Milton staff.
// Ranking stays on the server. Company comes from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolveRestaurantCockpitLanguage } from "@/lib/restaurant/language";
import { DATE_RE } from "@/lib/restaurant/odoo/sync-window";
import {
  NO_STORED_BLOCKS_ERROR,
  runRecipeSuggestionsForCompany,
} from "@/lib/restaurant/recipe-suggestion-server";
import { createDefaultWorkbookAi } from "@/lib/restaurant/cost-workbook";
import { isWorkbookLimitError } from "@/lib/restaurant/cost-workbook";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function readLimit(raw: unknown): number | { error: string } {
  if (raw == null || raw === "") return 20;
  const limit = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { error: "limit tiene que ser un entero entre 1 y 200." };
  }
  return limit;
}

/** How many products a full run covers at most (top sellers first). */
const MAX_SUGGESTION_PRODUCTS = 40;

function readOffset(raw: unknown): number | { error: string } {
  if (raw == null || raw === "") return 0;
  const offset = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) {
    return { error: "offset tiene que ser un entero desde 0." };
  }
  return offset;
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      {
        error:
          "Envía JSON. El archivo se sube una sola vez, en «Subir Excel de costos».",
      },
      { status: 400 }
    );
  }
  const limitRaw = body.limit;
  const offsetRaw = body.offset;
  const productRaw = body.odoo_product_id;
  const startParam =
    typeof body.start_date === "string" ? body.start_date : null;
  const endParam = typeof body.end_date === "string" ? body.end_date : null;
  const locationId =
    typeof body.location_id === "string" && body.location_id.trim()
      ? body.location_id.trim()
      : null;

  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "recipes.edit", {
    message: "Tu rol no puede preparar recetas.",
  });
  if (denied) return denied;

  const limit = readLimit(limitRaw);
  if (typeof limit !== "number") {
    return NextResponse.json({ error: limit.error }, { status: 400 });
  }
  const offset = readOffset(offsetRaw);
  if (typeof offset !== "number") {
    return NextResponse.json({ error: offset.error }, { status: 400 });
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
      currency: currency || "USD",
      limit,
      offset,
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
      const status = result.error === NO_STORED_BLOCKS_ERROR ? 400 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }
    // Paging for small chunks: the client keeps calling with next_offset.
    const total = Math.min(result.product_count, MAX_SUGGESTION_PRODUCTS);
    const nextOffset = offset + limit;
    return NextResponse.json({
      ...result,
      offset,
      limit,
      total,
      next_offset: nextOffset < total ? nextOffset : null,
    });
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
