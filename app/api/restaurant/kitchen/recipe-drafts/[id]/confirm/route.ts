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
  confirmKitchenDraftAsPreparation,
  confirmKitchenDraftAsVersion,
  findPreparationConfirmedByDraft,
  isStaleClaim,
} from "@/lib/restaurant/telegram/kitchen-draft-confirm";
import {
  isUsableLineUnit,
  convertToSubRecipeUnit,
} from "@/lib/restaurant/units";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { archivedIngredientMessage } from "@/lib/restaurant/ingredient-active";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import { KITCHEN_UNITS } from "@/lib/restaurant/kitchen-units";
import {
  isPreparationName,
  stripPreparationMarker,
} from "@/lib/restaurant/recipe-upload/marker";
import { latestCostEntry } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

export const dynamic = "force-dynamic";

interface ConfirmBody {
  /** "preparacion" confirms a preparation draft into Menú › Preparaciones. */
  kind?: string;
  yield_quantity?: unknown;
  yield_unit?: unknown;
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
      "id, company_id, status, dish_name, portions, currency, confirmed_recipe_id, confirmed_at"
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

  // A draft marked as preparación goes to Menú › Preparaciones; a plato goes
  // to Platos. The marker on the stored name decides, never the client.
  const isPreparation = isPreparationName(
    typeof draft.dish_name === "string" ? draft.dish_name : ""
  );
  let yieldQuantity = 0;
  let yieldUnit = "";
  if (isPreparation) {
    if (body.kind !== "preparacion") {
      return fail("Indica cuánto rinde esta preparación.", 400);
    }
    // A second Confirmar answers with the version the first one created.
    const done = await findPreparationConfirmedByDraft(
      admin,
      auth.companyId,
      draftId
    );
    if (done) {
      return NextResponse.json({
        ok: true,
        kind: "preparacion",
        component_id: done.componentId,
        version_id: done.versionId,
        status: "in_review",
      });
    }
    if (draft.status === "confirmed" && !staleClaim) {
      return fail("Esta receta se está confirmando. Espera un momento.", 409);
    }
    const q = body.yield_quantity;
    if (typeof q !== "number" || !Number.isFinite(q) || q <= 0) {
      return fail("Indica cuánto rinde esta preparación (mayor a 0).", 400);
    }
    const u = typeof body.yield_unit === "string" ? body.yield_unit.trim() : "";
    if (!KITCHEN_UNITS.some((k) => k.value === u)) {
      return fail("Elige la unidad en la que rinde esta preparación.", 400);
    }
    yieldQuantity = q;
    yieldUnit = u;
  } else if (body.kind === "preparacion") {
    return fail("Esta receta es un plato, no una preparación.", 400);
  }

  if (!isPreparation && draft.status === "confirmed" && !staleClaim) {
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
    !isPreparation &&
    (!body.portions || body.portions <= 0 || !Number.isInteger(body.portions))
  ) {
    return fail("Escribe cuántas porciones salen (un número entero).", 400);
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return fail("Agrega al menos un ingrediente.", 400);
  }

  if (!isPreparation && body.menu_item_id) {
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

  // Current price of each ingredient (paged; the shared "latest entry" rule).
  // A line WITHOUT a price is saved normally and stays «Sin precio»; only a
  // unit that cannot be read in the price's unit is refused.
  const costEntries = await fetchAllRows<IngredientCostEntry>(() =>
    admin
      .from("ingredient_cost_entries")
      .select(
        "id, ingredient_id, source_type, cost_date, effective_date, date_source, normalized_unit_cost, normalized_unit, unit_cost, created_at"
      )
      .eq("company_id", auth.companyId)
      .in("ingredient_id", ingredientIds)
  );
  // Fail closed: if the prices cannot be read, every line would look unpriced
  // and the unit check would be skipped. Nothing has been written yet.
  if (costEntries.error) {
    return fail("No pude leer los precios. Inténtalo de nuevo.", 500);
  }
  const entriesByIngredient = new Map<string, IngredientCostEntry[]>();
  for (const entry of costEntries.rows) {
    const list = entriesByIngredient.get(entry.ingredient_id) ?? [];
    list.push(entry);
    entriesByIngredient.set(entry.ingredient_id, list);
  }

  for (const line of body.lines) {
    const latest = latestCostEntry(
      entriesByIngredient.get(line.ingredient_id) ?? []
    );
    if (!latest?.normalized_unit) continue; // no price yet: any recognized unit
    const conversion = convertToSubRecipeUnit(
      line.total_quantity,
      line.unit,
      latest.normalized_unit
    );
    if (!conversion.ok) {
      return fail(
        `No puedo convertir "${line.unit}" a la unidad del precio de ${nameOf(line.ingredient_id)} (${latest.normalized_unit}).`,
        400
      );
    }
  }

  if (isPreparation) {
    const prepName = stripPreparationMarker(dishName).trim();
    if (!prepName) return fail("Escribe el nombre de la preparación.", 400);
    const prep = await confirmKitchenDraftAsPreparation(admin, {
      companyId: auth.companyId,
      userId: user.id,
      draftId,
      name: prepName,
      yieldQuantity,
      yieldUnit,
      lines: body.lines.map((line) => ({
        ingredient_id: line.ingredient_id,
        total_quantity: line.total_quantity,
        unit: line.unit,
      })),
    });
    if (!prep.ok) return fail(prep.error, prep.status);
    return NextResponse.json({
      ok: true,
      kind: "preparacion",
      component_id: prep.componentId,
      version_id: prep.versionId,
      // Created for review; not approved, not counted in Costos yet.
      status: "in_review",
    });
  }

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
