// POST /api/restaurant/recipes/menu
//
// Body (JSON): { url } or { text }, optional location_id.
//
// "Leer menú (opcional)": read the restaurant's menu (its web page, or
// text the person pastes) and leave a Sugerido draft for every POS dish
// with no recipe yet. Nothing is approved and no ingredient is created;
// quantities stay Pendiente. Owner, admin, manager or Milton staff.
// Company comes from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { MAX_MENU_TEXT } from "@/lib/restaurant/menu-reading/sources";
import {
  MenuReadError,
  readMenuIntoDrafts,
} from "@/lib/restaurant/menu-reading/server";
import { apiDictionary } from "@/lib/restaurant/api-lang";

const apiMsg = async () => (await apiDictionary()).menu.workspace.api;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_URL_LENGTH = 2_000;

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: (await apiMsg()).menuSendUrlOrText },
      { status: 400 }
    );
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if ((url && text) || (!url && !text)) {
    return NextResponse.json(
      {
        error: (await apiMsg()).menuSendOneOfTwo,
      },
      { status: 400 }
    );
  }
  if (url.length > MAX_URL_LENGTH) {
    return NextResponse.json(
      { error: (await apiMsg()).menuUrlTooLong },
      { status: 400 }
    );
  }
  if (text.length > MAX_MENU_TEXT) {
    return NextResponse.json(
      { error: (await apiMsg()).menuTextTooLong },
      { status: 400 }
    );
  }
  const locationId =
    typeof body.location_id === "string" && body.location_id.trim()
      ? body.location_id.trim()
      : null;

  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "recipes.edit", {
    message: (await apiMsg()).roleCannotPrepare,
  });
  if (denied) return denied;

  const currency = await resolveCompanyCurrency(auth.supabase, auth.companyId);
  try {
    const result = await readMenuIntoDrafts(auth.supabase, {
      companyId: auth.companyId,
      currency: currency || "USD",
      source: url ? { kind: "url", url } : { kind: "text", text },
      createdBy: auth.userId,
      locationId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MenuReadError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[recipes-menu]", err);
    return NextResponse.json(
      { error: (await apiMsg()).menuReadFailed },
      { status: 500 }
    );
  }
}
