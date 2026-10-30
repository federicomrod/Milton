// app/api/mobile/v1/kitchen/retry/route.ts
//
// POST { reportId }: «Reintentar» on a card that stayed on «processing». The
// message is run through the pipeline again on the server (only the cook's own
// report, only if it did not finish). Device token as bearer.

import { getDictionary } from "@/lib/i18n";
import {
  kitchenJson,
  mobileLanguage,
  UUID_RE,
} from "@/lib/restaurant/kitchen/mobile-response";
import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import { requeueAppReport } from "@/lib/restaurant/kitchen/pipeline/app-message";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const { admin, staff } = auth;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return kitchenJson({ error: d.kitchen.api.messageInvalid }, 400);
  }
  const reportId = typeof body.reportId === "string" ? body.reportId : "";
  if (!UUID_RE.test(reportId)) {
    return kitchenJson({ error: d.kitchen.api.messageInvalid }, 400);
  }
  try {
    const outcome = await requeueAppReport({
      staffId: staff.id,
      reportId,
      admin,
    });
    if (outcome === "not_found") {
      return kitchenJson({ error: d.kitchen.api.messageInvalid }, 404);
    }
    return kitchenJson({ status: outcome });
  } catch (err) {
    console.error(
      "[mobile-kitchen-retry] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: d.kitchen.api.messageSaveFailed }, 500);
  }
}
