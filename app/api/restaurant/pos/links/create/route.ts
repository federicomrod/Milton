import { NextRequest, NextResponse } from "next/server";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { toRecipeActor } from "@/lib/restaurant/recipe-costing/approval";
import { createRecipeAndLink } from "@/lib/restaurant/recipe-costing/link-actions-server";

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
  const odooProductId = Number(body.odoo_product_id);
  const odooName =
    typeof body.odoo_name === "string" ? body.odoo_name.trim() : "";
  if (!Number.isInteger(odooProductId) || odooProductId <= 0 || !odooName) {
    return NextResponse.json(
      { error: d.connect.api.linkCreateMissing },
      { status: 400 }
    );
  }
  const permission = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(permission, "links.confirm");
  if (denied) return denied;
  const actor = toRecipeActor(permission);
  try {
    const result = await createRecipeAndLink({
      supabase: auth.supabase,
      companyId: auth.companyId,
      actor,
      odooProductId,
      odooName,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      menu_item_id: result.menu_item_id,
      link: result.link,
    });
  } catch (err) {
    console.error("[pos/links/create]", err);
    return NextResponse.json(
      { error: d.connect.api.recipeCreateFailed },
      { status: 500 }
    );
  }
}
