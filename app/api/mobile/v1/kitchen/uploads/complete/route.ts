// app/api/mobile/v1/kitchen/uploads/complete/route.ts
//
// POST: step 2 of a direct upload (mobile P1, #431). The phone has PUT the file
// to Storage; this checks the report is this cook's, the path is this report's
// own (company / location / report id), that the object really is there and
// not over the cap, then registers it through ingestKitchenMedia({ channel:
// "app" }) without moving any bytes. Calling it twice gives the same answer
// with duplicate: true.

import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import { CLIENT_REF_RE } from "@/lib/restaurant/kitchen/app-reports";
import { ingestKitchenMedia } from "@/lib/restaurant/kitchen/pipeline/ingest";
import {
  KITCHEN_MEDIA_MAX_BYTES,
  getKitchenMediaObject,
  parseKitchenMediaPath,
  removeKitchenMediaObject,
} from "@/lib/restaurant/kitchen/media-storage";
import { serializeKitchenUpload } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { UUID_RE, kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

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
  const clientRef = typeof body.clientRef === "string" ? body.clientRef : "";
  const path = typeof body.path === "string" ? body.path : "";
  if (!UUID_RE.test(reportId) || !CLIENT_REF_RE.test(clientRef) || !path) {
    return kitchenJson({ error: d.kitchen.api.messageInvalid }, 400);
  }

  try {
    // The report must be this cook's own, for this clientRef.
    const { data: report } = await admin
      .from("kitchen_reports")
      .select("id, media_kind, media_mime, media_duration_s, media_size_bytes")
      .eq("id", reportId)
      .eq("company_id", staff.companyId)
      .eq("staff_id", staff.id)
      .eq("client_ref", clientRef)
      .maybeSingle();
    if (!report) {
      return kitchenJson({ error: d.kitchen.api.submissionNotFound }, 404);
    }

    // The path must be this company's, this location's and this report's own.
    const parsed = parseKitchenMediaPath(path);
    if (
      !parsed ||
      parsed.companyId !== staff.companyId ||
      parsed.locationId !== staff.locationId ||
      parsed.mediaId.toLowerCase() !== reportId.toLowerCase()
    ) {
      return kitchenJson({ error: d.kitchen.api.fileNotYours }, 403);
    }

    const { data: stored } = await admin
      .from("kitchen_media")
      .select("id")
      .eq("company_id", staff.companyId)
      .eq("kitchen_report_id", reportId)
      .limit(1)
      .maybeSingle();
    if (stored) {
      return kitchenJson(
        serializeKitchenUpload({
          reportId,
          mediaId: stored.id as string,
          duplicate: true,
        })
      );
    }

    const object = await getKitchenMediaObject(admin, path);
    if (!object.ok) {
      return kitchenJson({ error: d.kitchen.api.fileCheckFailed }, 502);
    }
    if (!object.exists) {
      return kitchenJson({ error: d.kitchen.api.fileNotArrived }, 409);
    }
    if (
      typeof object.sizeBytes === "number" &&
      object.sizeBytes > KITCHEN_MEDIA_MAX_BYTES
    ) {
      await removeKitchenMediaObject(admin, path);
      return kitchenJson({ error: d.kitchen.api.fileTooBig }, 413);
    }

    const mime = (report.media_mime as string | null) ?? null;
    const kind =
      report.media_kind === "photo" || report.media_kind === "voice"
        ? (report.media_kind as "photo" | "voice")
        : mime === "application/pdf"
          ? "document"
          : null;
    if (!kind) {
      return kitchenJson({ error: d.kitchen.api.fileTypeInvalid }, 400);
    }

    const ingested = await ingestKitchenMedia({
      channel: "app",
      companyId: staff.companyId,
      locationId: staff.locationId,
      staffId: staff.id,
      kitchenReportId: reportId,
      kind,
      mime,
      sizeBytes:
        object.sizeBytes ?? (report.media_size_bytes as number | null) ?? null,
      durationS: (report.media_duration_s as number | null) ?? null,
      sourceRef: `${staff.id}:${clientRef}`,
      storedAtPath: path,
    });
    if (!ingested.ok) {
      return kitchenJson({ error: d.kitchen.api.fileSaveFailed }, 502);
    }
    return kitchenJson(
      serializeKitchenUpload({
        reportId,
        mediaId: ingested.mediaId,
        duplicate: ingested.duplicate,
      }),
      ingested.duplicate ? 200 : 201
    );
  } catch (err) {
    console.error(
      "[mobile-kitchen-uploads] complete failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: d.kitchen.api.fileSaveFailed }, 500);
  }
}
