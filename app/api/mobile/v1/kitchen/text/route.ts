// app/api/mobile/v1/kitchen/text/route.ts
//
// POST: a text-only report from the app. Same retry dedupe as media: the same
// clientRef from the same cook is the same report. AI processing of app items
// is a later PR.

import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import {
  CLIENT_REF_RE,
  cleanReportText,
  findOrCreateAppReport,
} from "@/lib/restaurant/kitchen/app-reports";
import { serializeKitchenUpload } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { scheduleAppProcessing } from "@/lib/restaurant/kitchen/pipeline/app-message";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

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
  const clientRef = typeof body.clientRef === "string" ? body.clientRef : "";
  if (!CLIENT_REF_RE.test(clientRef)) {
    return kitchenJson({ error: d.kitchen.api.clientRefMissing }, 400);
  }
  const text = cleanReportText(body.text);
  if (!text) return kitchenJson({ error: d.kitchen.api.writeMessage }, 400);

  const report = await findOrCreateAppReport(
    admin,
    {
      id: staff.id,
      companyId: staff.companyId,
      locationId: staff.locationId,
    },
    {
      clientRef,
      text,
      mediaKind: null,
      mime: null,
      durationS: null,
      sizeBytes: null,
    }
  );
  if (!report.ok) {
    return kitchenJson({ error: d.kitchen.api.messageSaveFailed }, 500);
  }
  // Run it through the same pipeline Telegram messages use, after answering.
  // Once per report (the processor claims it), so a retry does nothing.
  scheduleAppProcessing({ staffId: staff.id, reportId: report.reportId });
  return kitchenJson(
    serializeKitchenUpload({
      reportId: report.reportId,
      duplicate: report.duplicate,
    }),
    report.duplicate ? 200 : 201
  );
}
