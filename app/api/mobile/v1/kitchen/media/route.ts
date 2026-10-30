// app/api/mobile/v1/kitchen/media/route.ts
//
// POST multipart: file, kind (photo | voice | document), clientRef, optional
// text and durationS. Creates the cook's kitchen_reports row (channel 'app',
// no Telegram ids) and stores the file through ingestKitchenMedia() with
// channel "app". The same clientRef again returns the existing report and
// stores nothing twice. AI processing of app items is a later PR.
//
// The app does NOT use this route: it sends files straight to Storage with
// kitchen/uploads + kitchen/uploads/complete (mobile P1). This multipart route
// stays for small files and tests.
//
// Size and type are checked before the bytes are handed to Storage. The
// platform may cap request bodies below 25 MB; the app should send
// compressed photos and short voice notes.

import { getDictionary } from "@/lib/i18n";
import { mobileLanguage } from "@/lib/restaurant/kitchen/mobile-response";
import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import {
  CLIENT_REF_RE,
  cleanReportText,
  deleteAppReport,
  findOrCreateAppReport,
} from "@/lib/restaurant/kitchen/app-reports";
import { ingestKitchenMedia } from "@/lib/restaurant/kitchen/pipeline/ingest";
import {
  KITCHEN_MEDIA_MAX_BYTES,
  KITCHEN_MEDIA_MIMES,
  mimeMatchesKind,
} from "@/lib/restaurant/kitchen/media-storage";
import { serializeKitchenUpload } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Room for the multipart envelope around a file at the size cap.
const BODY_OVERHEAD_BYTES = 1024 * 1024;
const MAX_DURATION_S = 60 * 60;

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const { admin, staff } = auth;

  if (
    !(request.headers.get("content-type") ?? "").includes("multipart/form-data")
  ) {
    return kitchenJson({ error: d.kitchen.api.sendAsForm }, 415);
  }
  const declared = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > KITCHEN_MEDIA_MAX_BYTES + BODY_OVERHEAD_BYTES
  ) {
    return kitchenJson({ error: d.kitchen.api.fileTooBig }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return kitchenJson({ error: d.kitchen.api.fileReadFailed }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return kitchenJson({ error: d.kitchen.api.fileMissing }, 400);
  }
  const kind = form.get("kind");
  if (kind !== "photo" && kind !== "voice" && kind !== "document") {
    return kitchenJson({ error: d.kitchen.api.fileTypeInvalid }, 400);
  }
  const clientRef = form.get("clientRef");
  if (typeof clientRef !== "string" || !CLIENT_REF_RE.test(clientRef)) {
    return kitchenJson({ error: d.kitchen.api.clientRefMissing }, 400);
  }

  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!KITCHEN_MEDIA_MIMES.includes(mime) || !mimeMatchesKind(kind, mime)) {
    return kitchenJson({ error: d.kitchen.api.fileTypeUnsupported }, 415);
  }
  if (file.size <= 0) {
    return kitchenJson({ error: d.kitchen.api.fileEmpty }, 400);
  }
  if (file.size > KITCHEN_MEDIA_MAX_BYTES) {
    return kitchenJson({ error: d.kitchen.api.fileTooBig }, 413);
  }

  const rawDuration = Number(form.get("durationS"));
  const durationS =
    kind === "voice" &&
    Number.isFinite(rawDuration) &&
    rawDuration > 0 &&
    rawDuration <= MAX_DURATION_S
      ? Math.round(rawDuration)
      : null;

  const reportStaff = {
    id: staff.id,
    companyId: staff.companyId,
    locationId: staff.locationId,
  };

  try {
    const report = await findOrCreateAppReport(admin, reportStaff, {
      clientRef,
      text: cleanReportText(form.get("text")),
      mediaKind: kind === "document" ? null : kind,
      mime,
      durationS,
      sizeBytes: file.size,
    });
    if (!report.ok) {
      return kitchenJson({ error: d.kitchen.api.submissionSaveFailed }, 500);
    }

    if (report.duplicate) {
      const { data: stored } = await admin
        .from("kitchen_media")
        .select("id")
        .eq("company_id", staff.companyId)
        .eq("kitchen_report_id", report.reportId)
        .limit(1)
        .maybeSingle();
      if (stored) {
        return kitchenJson(
          serializeKitchenUpload({
            reportId: report.reportId,
            mediaId: stored.id as string,
            duplicate: true,
          }),
          200
        );
      }
    }

    const ingested = await ingestKitchenMedia({
      channel: "app",
      companyId: staff.companyId,
      locationId: staff.locationId,
      staffId: staff.id,
      kitchenReportId: report.reportId,
      kind,
      mime,
      sizeBytes: file.size,
      durationS,
      // Prefixed with the cook so two cooks can never collide on a clientRef.
      sourceRef: `${staff.id}:${clientRef}`,
      getBytes: async () => new Uint8Array(await file.arrayBuffer()),
    });
    if (!ingested.ok) {
      if (!report.duplicate)
        await deleteAppReport(admin, reportStaff, report.reportId);
      if (ingested.error === "unsupported type") {
        return kitchenJson({ error: d.kitchen.api.fileTypeUnsupported }, 415);
      }
      if (ingested.error === "file too large") {
        return kitchenJson({ error: d.kitchen.api.fileTooBig }, 413);
      }
      return kitchenJson({ error: d.kitchen.api.fileSaveFailed }, 502);
    }

    const duplicate = report.duplicate || ingested.duplicate;
    return kitchenJson(
      serializeKitchenUpload({
        reportId: report.reportId,
        mediaId: ingested.mediaId,
        duplicate,
      }),
      duplicate ? 200 : 201
    );
  } catch (err) {
    console.error(
      "[mobile-kitchen-media] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: d.kitchen.api.fileSaveFailed }, 500);
  }
}
