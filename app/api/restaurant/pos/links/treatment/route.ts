// POST /api/restaurant/pos/links/treatment
// Body: { items: [{ odoo_product_id, odoo_name, treatment, source? }],
//         location_id?, source?: "manual" | "sugerencia", confirmed_how? }
// source "sugerencia" records that the person accepted Milton's suggestion.
//
// A person saves how each POS product is costed (premise 8). Owner, admin,
// manager or Milton staff; "excluido" only for the roles that approve recipes
// (owner or admin; Milton staff with confirmed_how from the client), because
// it takes sales out of coverage. Only the classification changes: never the link
// state, the recipe or a confirmation. Company and user come from auth.

import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isPosProductClassification } from "@/lib/restaurant/pos-product-links";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import {
  EXCLUDE_CLIENT_CONFIRMATION_ERROR,
  EXCLUDE_ROLE_ERROR,
  TREATMENT_MIGRATION_ERROR,
  TREATMENT_ROLE_ERROR,
  setPosProductTreatments,
  type TreatmentItem,
} from "@/lib/restaurant/recipe-costing/link-actions-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const d = await apiDictionary();
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: d.connect.api.bodyMustBeJson },
      { status: 400 }
    );
  }

  const raw = Array.isArray(body.items) ? body.items : [];
  const items: TreatmentItem[] = [];
  for (const entry of raw) {
    const row =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};
    const id = Number(row.odoo_product_id);
    if (
      !Number.isInteger(id) ||
      id <= 0 ||
      !isPosProductClassification(row.treatment) ||
      row.treatment === "por_clasificar"
    ) {
      return NextResponse.json(
        { error: d.connect.api.treatmentMissing },
        { status: 400 }
      );
    }
    items.push({
      odoo_product_id: id,
      odoo_name: typeof row.odoo_name === "string" ? row.odoo_name : "",
      treatment: row.treatment,
      source:
        row.source === "sugerencia" || row.source === "manual"
          ? row.source
          : undefined,
    });
  }
  if (items.length === 0) {
    return NextResponse.json(
      { error: d.connect.api.atLeastOneProduct },
      { status: 400 }
    );
  }

  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  try {
    const result = await setPosProductTreatments({
      supabase: auth.supabase,
      companyId: auth.companyId,
      actor,
      items,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
      source: body.source === "sugerencia" ? "sugerencia" : "manual",
      confirmedHow:
        typeof body.confirmed_how === "string" ? body.confirmed_how : null,
    });
    if (!result.ok) {
      const status =
        result.error === TREATMENT_ROLE_ERROR ||
        result.error === EXCLUDE_ROLE_ERROR ||
        result.error === EXCLUDE_CLIENT_CONFIRMATION_ERROR
          ? 403
          : result.error === TREATMENT_MIGRATION_ERROR
            ? 409
            : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ saved: result.saved });
  } catch (err) {
    console.error("[pos/links/treatment]", err);
    return NextResponse.json(
      { error: d.connect.api.treatmentSaveFailed },
      { status: 500 }
    );
  }
}
