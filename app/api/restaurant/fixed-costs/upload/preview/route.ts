// app/api/restaurant/fixed-costs/upload/preview/route.ts
//
// GET ?draftId=<uuid> → the review of an upload draft: for every destination
// (month, restaurant or group, category) what exists today, what the file
// brings, whether it is new / already there / an overlap, what «Sumar» and
// «Reemplazar» would each leave, and the versions the approval must send back.
// A pure read (the database function is STABLE): previewing never writes.

import { NextRequest, NextResponse } from "next/server";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { requireCapability } from "@/lib/auth/permissions";
import { authorizeFixedCosts } from "@/lib/restaurant/fixed-costs-auth";
import { previewUpload } from "@/lib/restaurant/fixed-cost-commands";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const dict = getDictionary(await apiLanguage());
  const auth = await authorizeFixedCosts();
  if (!auth.ok) return auth.response;
  const denied = requireCapability(auth.actor, "costs.fixed", {
    message: dict.costs.fixed.roleDenied,
  });
  if (denied) return denied;
  const draftId = req.nextUrl.searchParams.get("draftId");
  if (!draftId)
    return NextResponse.json(
      { error: dict.costs.fixedUpload.errNotFound },
      { status: 404 }
    );
  const res = await previewUpload(
    {
      supabase: auth.supabase,
      companyId: auth.companyId,
      userId: auth.userId,
    },
    draftId
  );
  if (!res.ok)
    return NextResponse.json(
      {
        error:
          res.failure === "forbidden"
            ? dict.costs.fixed.roleDenied
            : dict.costs.fixedUpload.errNotFound,
      },
      { status: res.failure === "forbidden" ? 403 : 404 }
    );
  return NextResponse.json(res.value);
}
