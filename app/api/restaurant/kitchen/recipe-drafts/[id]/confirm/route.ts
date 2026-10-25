// app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route.ts
//
// POST /api/restaurant/kitchen/recipe-drafts/:id/confirm
//
// Confirms a recipe a cook sent through Telegram. Confirming is NOT approving:
// it adds a NEW recipe version in status `in_review` for the chosen dish (or
// for a new dish, created with no price). Existing recipe lines and any
// approved / manual version are never changed. Nothing counts in Costos or
// margins until the version is approved in the normal flow.
// Only Milton admins and owners / admins / managers of the company can confirm
// (enforced server-side). The company comes from auth, never from the client.
// All errors are Spanish and name the ingredient, never a raw id.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { KITCHEN_FORBIDDEN_MESSAGE } from "@/lib/restaurant/telegram/kitchen-manager-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  requireCapability,
  resolveActor,
  unauthorizedResponse,
} from "@/lib/auth/permissions";
import {
  confirmKitchenDraftAsVersion,
  isStaleClaim,
} from "@/lib/restaurant/telegram/kitchen-draft-confirm";
import { isUsableLineUnit } from "@/lib/restaurant/units";
import { archivedIngredientMessage } from "@/lib/restaurant/ingredient-active";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";

export const dynamic = "force-dynamic";

interface ConfirmBody {
  dish_name: string;
  portions: number;
  menu_item_id?: string;
  selling_price?: number;
  lines: Array<{
    id?: string;
    ingredient_id: string;
    total_quantity: number;
    unit: string;
  }>;
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorizedResponse();

  const actor = await resolveActor(null, user.id, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "kitchen.drafts", {
    message: KITCHEN_FORBIDDEN_MESSAGE,
  });
  if (denied) return denied;

  const { id: draftId } = await params;
  let body: ConfirmBody;
  try {
    body = (await req.json()) as ConfirmBody;
  } catch {
    return fail("No pude leer lo que enviaste. Inténtalo de nuevo.", 400);
  }

  const admin = createAdminClient();

  // The draft must belong to THIS company. Another company's draft answers
  // exactly like one that does not exist.
  const { data: draft, error: draftError } = await admin
    .from("kitchen_recipe_drafts")
    .select(
      "id, company_id, status, portions, currency, confirmed_recipe_id, confirmed_at"
    )
    .eq("id", draftId)
    .eq("company_id", auth.companyId)
    .maybeSingle();
  if (draftError || !draft || draft.company_id !== auth.companyId) {
    return fail("No encontré esa receta.", 404);
  }

  // A draft still waiting for portions can be confirmed when the reviewer
  // typed them (checked below); nothing is saved unless the confirm works.
  if (
    draft.status !== "draft" &&
    draft.status !== "confirmed" &&
    draft.status !== "awaiting_portions"
  ) {
    return fail("Esta receta ya no está pendiente de revisar.", 400);
  }

  // A claim that never finished (the call died) and is older than 2 minutes
  // is taken over below; a younger one is a request still being written.
  const staleClaim = isStaleClaim(draft);
  if (draft.status === "confirmed" && !staleClaim) {
    const { data: existing } = await admin
      .from("kitchen_recipe_drafts")
      .select("confirmed_recipe_id, menu_item_id")
      .eq("id", draftId)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    // Confirmed but no recipe yet: another request is still writing it.
    if (!existing?.confirmed_recipe_id) {
      return fail("Esta receta se está confirmando. Espera un momento.", 409);
    }
    return NextResponse.json({
      ok: true,
      recipe_id: existing.confirmed_recipe_id,
      menu_item_id: existing.menu_item_id,
    });
  }

  const dishName =
    typeof body.dish_name === "string" ? body.dish_name.trim() : "";
  if (!dishName) return fail("Escribe el nombre del plato.", 400);

  if (
    !body.portions ||
    body.portions <= 0 ||
    !Number.isInteger(body.portions)
  ) {
    return fail("Escribe cuántas porciones salen (un número entero).", 400);
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return fail("Agrega al menos un ingrediente.", 400);
  }

  if (body.menu_item_id) {
    const { data: menuItem } = await admin
      .from("menu_items")
      .select("id")
      .eq("id", body.menu_item_id)
      .eq("company_id", auth.companyId)
      .maybeSingle();
    if (!menuItem) {
      return fail("Ese plato no existe en tu empresa.", 400);
    }
  }

  const { data: draftLines } = await admin
    .from("kitchen_recipe_draft_lines")
    .select("id, ingredient_id")
    .eq("draft_id", draftId)
    .eq("company_id", auth.companyId);
  const draftLineIds = new Set((draftLines ?? []).map((l) => l.id));
  const isExistingLineId = (id: string | undefined): id is string =>
    !!id && !id.startsWith("new-");

  for (const line of body.lines) {
    if (isExistingLineId(line.id) && !draftLineIds.has(line.id)) {
      return fail("Una de las líneas no pertenece a esta receta.", 400);
    }
    if (!line.ingredient_id) {
      return fail("Elige el ingrediente de todas las líneas.", 400);
    }
  }

  // Ingredient names for the messages (company-scoped).
  const ingredientIds = body.lines.map((l) => l.ingredient_id);
  // archived_at too: a merged-away ingredient is never saved on a recipe line.
  // (Before the archive column exists nothing is archived.)
  type IngredientResult = {
    data: Array<Record<string, unknown>> | null;
    error: { message?: string } | null;
  };
  let ingredientRes = (await admin
    .from("ingredients")
    .select("id, name, default_unit, archived_at")
    .eq("company_id", auth.companyId)
    .in("id", ingredientIds)) as unknown as IngredientResult;
  if (
    ingredientRes.error &&
    /archived_at/.test(ingredientRes.error.message ?? "")
  ) {
    ingredientRes = (await admin
      .from("ingredients")
      .select("id, name, default_unit")
      .eq("company_id", auth.companyId)
      .in("id", ingredientIds)) as unknown as IngredientResult;
  }
  const ingredients = ingredientRes.data as Array<
    Record<string, unknown>
  > | null;
  const nameById = new Map(
    (ingredients ?? []).map((i) => [i.id as string, String(i.name ?? "")])
  );
  const archivedIds = new Set(
    (ingredients ?? []).filter((i) => i.archived_at).map((i) => i.id as string)
  );
  const nameOf = (id: string) => nameById.get(id) || "ese ingrediente";

  for (const line of body.lines) {
    if (!nameById.has(line.ingredient_id)) {
      return fail("Uno de los ingredientes ya no está en tu lista.", 400);
    }
    if (archivedIds.has(line.ingredient_id)) {
      // Merged into another ingredient? Say which one to use instead.
      const merged = await createSupabaseEditorStore(admin)
        .mergedInto(auth.companyId, line.ingredient_id)
        .catch(() => null);
      return fail(
        archivedIngredientMessage(
          nameOf(line.ingredient_id),
          merged?.name ?? null
        ),
        400
      );
    }
    if (!line.total_quantity || line.total_quantity <= 0) {
      return fail(`Falta la cantidad de ${nameOf(line.ingredient_id)}.`, 400);
    }
    if (!line.unit || !isUsableLineUnit(line.unit)) {
      return fail(
        `La unidad "${line.unit ?? ""}" de ${nameOf(line.ingredient_id)} no es válida.`,
        400
      );
    }
  }

  // A unit that cannot be read in the ingredient's price unit does NOT block
  // confirming: the line is saved exactly as written and stays uncosted
  // («Falta conversión», like «Sin precio») until a conversion is defined.

  const result = await confirmKitchenDraftAsVersion(admin, {
    companyId: auth.companyId,
    userId: user.id,
    draftId,
    dishName,
    portions: body.portions,
    menuItemId: body.menu_item_id || null,
    sellingPrice:
      typeof body.selling_price === "number" ? body.selling_price : null,
    currency: typeof draft.currency === "string" ? draft.currency : null,
    lines: body.lines.map((line) => ({
      ingredient_id: line.ingredient_id,
      total_quantity: line.total_quantity,
      unit: line.unit,
    })),
  });
  if (!result.ok) return fail(result.error, result.status);

  return NextResponse.json({
    ok: true,
    recipe_id: result.recipeId,
    menu_item_id: result.menuItemId,
    version_id: result.versionId,
    // Confirming sends the recipe to review; it is not approved yet.
    status: "in_review",
  });
}
