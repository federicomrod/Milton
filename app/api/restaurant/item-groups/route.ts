// POST /api/restaurant/item-groups   { ops: GroupOps }
//
// R1-15c (Agrupaciones F2): saves one grouping action (create / add / rename /
// combine / dissolve / move, or the "Deshacer" of one) in a single
// transaction (migration 049, item_groups_apply). Company and user come from
// auth, never from the request. The ops are checked here for shape and size;
// RLS, the unique index and the triggers of 048 re-check everything.

import { NextRequest, NextResponse } from "next/server";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { parseGroupOps } from "@/lib/restaurant/groups/parse-ops";
import { actionableError } from "@/lib/restaurant/actionable-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const api = (await apiDictionary()).menu.screens.api;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: api.bodyJson }, { status: 400 });
  }
  const parsed = parseGroupOps(body.ops);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "groups.manage", {
    message: api.roleGroups,
  });
  if (denied) return denied;

  const started = Date.now();
  const { data, error } = await auth.supabase.rpc("item_groups_apply", {
    p_company_id: auth.companyId,
    p_ops: parsed.ops,
  });
  if (error) {
    const code = error.code ?? "";
    if (code === "PGRST202" || code === "42883" || code === "42P01") {
      return NextResponse.json(
        {
          error: api.groupsInactive,
          unavailable: true,
        },
        { status: 409 }
      );
    }
    if (code === "23505") {
      return NextResponse.json({ error: api.groupDuplicate }, { status: 409 });
    }
    if (code === "23514" || code === "23503") {
      return NextResponse.json({ error: api.groupInvalid }, { status: 400 });
    }
    const failure = actionableError(error, api.saveGrouping, "item-groups");
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
  console.info(`[item-groups] apply ${Date.now() - started}ms`);
  return NextResponse.json({ ok: true, result: data });
}
