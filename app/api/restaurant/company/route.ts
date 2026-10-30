// /api/restaurant/company
//
//   GET   → { company: { id, name, industry?, currency } } of the signed-in person's
//           company. The company comes from the membership (auth), never
//           from the request; the old `companies.created_by` lookup finds
//           nothing for restaurant accounts, which made «Nombre de la
//           empresa» read «Sin definir».
//   PATCH → { name } renames the company; { preferred_language } changes the
//           language of the whole app for the company ("en" | "es" | "de").
//           Either one or both. RLS decides who may.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { normalizePreferredLanguage } from "@/lib/restaurant/language";
import { apiDictionary } from "@/lib/restaurant/api-lang";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.supabase
    .from("companies")
    .select("*")
    .eq("id", auth.companyId)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: (await apiDictionary()).errors.company.readFailed },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ company: null });
  // Same currency the cockpit and costs use (derived from the company's
  // data; El Salvador → USD). Ajustes and Cuenta show it read-only.
  const currency = await resolveCompanyCurrency(auth.supabase, auth.companyId);
  return NextResponse.json({ company: { ...data, currency } });
}

export async function PATCH(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "company.edit");
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    preferred_language?: unknown;
  } | null;
  const d = (await apiDictionary()).errors.company;
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const wantsLanguage = body?.preferred_language !== undefined;
  const wantsName = body?.name !== undefined || !wantsLanguage;

  if (wantsName) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) {
      return NextResponse.json({ error: d.nameRequired }, { status: 400 });
    }
    update.name = name;
  }
  if (wantsLanguage) {
    const language = normalizePreferredLanguage(body?.preferred_language);
    if (!language) {
      return NextResponse.json({ error: d.languageInvalid }, { status: 400 });
    }
    update.preferred_language = language;
  }

  const { data, error } = await auth.supabase
    .from("companies")
    .update(update)
    .eq("id", auth.companyId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { error: wantsName ? d.saveNameFailed : d.saveLanguageFailed },
      { status: 400 }
    );
  }
  return NextResponse.json({ company: data });
}
