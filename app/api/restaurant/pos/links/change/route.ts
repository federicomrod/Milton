import { NextRequest, NextResponse } from "next/server";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { changePosLinkForCompany } from "@/lib/restaurant/recipe-costing/link-actions-server";

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
  const menuItemId =
    typeof body.menu_item_id === "string" ? body.menu_item_id.trim() : "";
  if (!Number.isInteger(odooProductId) || odooProductId <= 0 || !menuItemId) {
    return NextResponse.json(
      { error: d.connect.api.linkChangeMissing },
      { status: 400 }
    );
  }
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "links.confirm");
  if (denied) return denied;
  try {
    const result = await changePosLinkForCompany({
      supabase: auth.supabase,
      companyId: auth.companyId,
      odooProductId,
      odooName: typeof body.odoo_name === "string" ? body.odoo_name : undefined,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
      menuItemId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ link: result.link });
  } catch (err) {
    console.error("[pos/links/change]", err);
    return NextResponse.json(
      { error: d.connect.api.linkChangeFailed },
      { status: 500 }
    );
  }
}
