// app/api/restaurant/kitchen/reports/resolve/route.ts
//
// POST { ids: string[] }: mark cook reports resolved for the caller's
// company. Any company member can resolve (fail closed on company_id).
// Service role write because kitchen_reports has no tenant UPDATE policy.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId, userId } = auth;

    let body: { ids?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "El cuerpo tiene que ser JSON." },
        { status: 400 }
      );
    }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter(
          (id): id is string => typeof id === "string" && UUID_RE.test(id)
        )
      : [];
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Los identificadores no son válidos." },
        { status: 400 }
      );
    }

    const { data, error } = await createAdminClient()
      .from("kitchen_reports")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
      })
      .eq("company_id", companyId)
      .in("id", ids)
      .is("resolved_at", null)
      .select("id");
    if (error) {
      console.error("[kitchen-reports] resolve failed:", error.message);
      return NextResponse.json(
        { error: "No pude resolver el aviso." },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, updated: data?.length ?? 0 });
  } catch (err) {
    console.error(
      "[kitchen-reports] resolve unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "No pude resolver el aviso." },
      { status: 500 }
    );
  }
}
