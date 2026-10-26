// GET  /api/restaurant/recipes/editor?odoo_product_id=&location_id=  (a dish)
// GET  /api/restaurant/recipes/editor?component_id=                  (a preparation)
// POST /api/restaurant/recipes/editor   { odoo_product_id, location_id?, action, ... }
//
// The Validar line editor. Reads and edits go through the recipe version's
// inputs by id; the cached evidence is rebuilt after each edit. Company and
// user come from auth, never from the request. Editing needs the same role
// that may prepare a recipe (owner, admin, manager, Milton staff).

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { can, resolveActor } from "@/lib/auth/permissions";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import { parseEditorAction } from "@/lib/restaurant/recipe-costing/editor-actions";
import { loadPriceEstimates } from "@/lib/restaurant/menu-reading/estimate-store";

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
  const componentId = str(req.nextUrl.searchParams.get("component_id"));
  const id = componentId
    ? 0
    : productId(req.nextUrl.searchParams.get("odoo_product_id"));
  if (id === null) {
    return NextResponse.json(
      { error: "Indica el producto que quieres editar." },
      { status: 400 }
    );
  }
  const started = Date.now();
  try {
    const result = await loadEditor({
      store: createSupabaseEditorStore(auth.supabase),
      companyId: auth.companyId,
      odooProductId: id,
      componentId: componentId ?? undefined,
      locationId: str(req.nextUrl.searchParams.get("location_id")),
      userId: auth.userId,
      omitOptions: req.nextUrl.searchParams.get("omit_options") === "1",
      // «Precio estimado» hint on lines with no real price (never a price).
      priceEstimates: async () => {
        const read = await loadPriceEstimates(auth.supabase, auth.companyId);
        return read.ok ? read.rows : [];
      },
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, conversion: result.conversion },
        { status: result.status ?? 400 }
      );
    }
    const ms = Date.now() - started;
    // One line per read, to measure it in the logs (no client data).
    console.info(`[recipes/editor] load ${ms}ms`);
    return NextResponse.json(result.state, {
      headers: { "Server-Timing": `load;dur=${ms}` },
    });
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
  const componentId = str(body.component_id);
  const id = componentId ? 0 : productId(body.odoo_product_id);
  const action = parseEditorAction(body);
  if (id === null || !action) {
    return NextResponse.json(
      { error: "Faltan datos para guardar este cambio." },
      { status: 400 }
    );
  }

  // R1-12: the role check runs while the dish and catalog are read;
  // applyEdit waits for it before its first write.
  const guard = resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  }).then((actor) =>
    can(actor, "recipes.edit")
      ? null
      : {
          ok: false as const,
          error: "Tu rol no puede editar recetas.",
          status: 403,
        }
  );
  // A failed role read must answer like the other errors, not leave an
  // unhandled rejection behind.
  guard.catch(() => undefined);

  const started = Date.now();
  try {
    const result = await applyEdit(
      {
        store: createSupabaseEditorStore(auth.supabase),
        companyId: auth.companyId,
        odooProductId: id,
        componentId: componentId ?? undefined,
        locationId: str(body.location_id),
        userId: auth.userId,
        omitOptions: body.omit_options === true,
        guard,
      },
      action
    );
    const ms = Date.now() - started;
    // One line per save, to measure it in the logs (no client data).
    console.info(`[recipes/editor] ${action.action} ${ms}ms`);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 }
      );
    }
    return NextResponse.json(result.state, {
      headers: { "Server-Timing": `edit;dur=${ms}` },
    });
  } catch (err) {
    console.error("[recipes/editor POST]", err);
    return NextResponse.json(
      { error: "No pude guardar el cambio." },
      { status: 500 }
    );
  }
}
