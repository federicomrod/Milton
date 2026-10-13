// GET  /api/restaurant/recipes/editor?odoo_product_id=&location_id=
// POST /api/restaurant/recipes/editor   { odoo_product_id, location_id?, action, ... }
//
// The Validar line editor. Reads and edits go through the recipe version's
// inputs by id; the cached evidence is rebuilt after each edit. Company and
// user come from auth, never from the request. Editing needs the same role
// that may prepare a recipe (owner, admin, manager, Milton staff).

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { actorCanSubmitForApproval } from "@/lib/restaurant/recipe-costing/approval";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import { parseEditorAction } from "@/lib/restaurant/recipe-costing/editor-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function productId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const id = productId(req.nextUrl.searchParams.get("odoo_product_id"));
  if (!id) {
    return NextResponse.json(
      { error: "Indica el producto que quieres editar." },
      { status: 400 }
    );
  }
  try {
    const result = await loadEditor({
      store: createSupabaseEditorStore(auth.supabase),
      companyId: auth.companyId,
      odooProductId: id,
      locationId: str(req.nextUrl.searchParams.get("location_id")),
      userId: auth.userId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 }
      );
    }
    return NextResponse.json(result.state);
  } catch (err) {
    console.error("[recipes/editor GET]", err);
    return NextResponse.json(
      { error: "No pude cargar los ingredientes de esta receta." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const id = productId(body.odoo_product_id);
  const action = parseEditorAction(body);
  if (!id || !action) {
    return NextResponse.json(
      { error: "Faltan datos para guardar este cambio." },
      { status: 400 }
    );
  }

  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  if (!actorCanSubmitForApproval(actor)) {
    return NextResponse.json(
      { error: "Tu rol no puede editar recetas." },
      { status: 403 }
    );
  }

  try {
    const result = await applyEdit(
      {
        store: createSupabaseEditorStore(auth.supabase),
        companyId: auth.companyId,
        odooProductId: id,
        locationId: str(body.location_id),
        userId: auth.userId,
      },
      action
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 }
      );
    }
    return NextResponse.json(result.state);
  } catch (err) {
    console.error("[recipes/editor POST]", err);
    return NextResponse.json(
      { error: "No pude guardar el cambio." },
      { status: 500 }
    );
  }
}
