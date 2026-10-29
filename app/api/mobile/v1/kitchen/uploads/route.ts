// app/api/mobile/v1/kitchen/uploads/route.ts
//
// POST: step 1 of a direct upload (mobile P1, #431). The app asks to send a
// photo / voice note / document; this creates (or finds, by clientRef) the
// cook's report and returns a signed Storage URL. The phone then PUTs the file
// straight to Storage, never through this server, and calls
// kitchen/uploads/complete. The object path is derived from the report id, so
// a path can only ever belong to the report it was issued for.

import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import {
  CLIENT_REF_RE,
  cleanReportText,
  deleteAppReport,
  findOrCreateAppReport,
} from "@/lib/restaurant/kitchen/app-reports";
import {
  KITCHEN_MEDIA_MAX_BYTES,
  KITCHEN_MEDIA_MIMES,
  KITCHEN_MEDIA_SIGNED_UPLOAD_TTL_S,
  buildKitchenMediaPath,
  createKitchenMediaSignedUploadUrl,
  mimeMatchesKind,
} from "@/lib/restaurant/kitchen/media-storage";
import { serializeKitchenUploadTicket } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DURATION_S = 60 * 60;

export async function POST(request: NextRequest) {
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const { admin, staff } = auth;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    return kitchenJson({ error: "El mensaje no es válido." }, 400);
  }

  const kind = body.kind;
  if (kind !== "photo" && kind !== "voice" && kind !== "document") {
    return kitchenJson({ error: "El tipo de archivo no es válido." }, 400);
  }
  const clientRef = typeof body.clientRef === "string" ? body.clientRef : "";
  if (!CLIENT_REF_RE.test(clientRef)) {
    return kitchenJson({ error: "Falta el identificador del envío." }, 400);
  }
  const mime =
    typeof body.mime === "string"
      ? body.mime.split(";")[0].trim().toLowerCase()
      : "";
  if (!KITCHEN_MEDIA_MIMES.includes(mime) || !mimeMatchesKind(kind, mime)) {
    return kitchenJson({ error: "No puedo guardar ese tipo de archivo." }, 415);
  }
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return kitchenJson({ error: "El archivo está vacío." }, 400);
  }
  if (sizeBytes > KITCHEN_MEDIA_MAX_BYTES) {
    return kitchenJson({ error: "El archivo es demasiado grande." }, 413);
  }
  const rawDuration = Number(body.durationS);
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
      text: cleanReportText(body.text),
      mediaKind: kind === "document" ? null : kind,
      mime,
      durationS,
      sizeBytes,
    });
    if (!report.ok) {
      return kitchenJson({ error: "No pude guardar tu envío." }, 500);
    }

    if (report.duplicate) {
      const { data: stored } = await admin
        .from("kitchen_media")
        .select("id, storage_path")
        .eq("company_id", staff.companyId)
        .eq("kitchen_report_id", report.reportId)
        .limit(1)
        .maybeSingle();
      if (stored) {
        return kitchenJson(
          serializeKitchenUploadTicket({
            reportId: report.reportId,
            uploadUrl: null,
            uploadToken: null,
            path: stored.storage_path as string,
            expiresInS: 0,
            duplicate: true,
          })
        );
      }
    }

    const path = buildKitchenMediaPath({
      companyId: staff.companyId,
      locationId: staff.locationId,
      mediaId: report.reportId,
      mime,
    });
    const signed = await createKitchenMediaSignedUploadUrl(admin, path);
    if (!signed.ok) {
      if (!report.duplicate) {
        await deleteAppReport(admin, reportStaff, report.reportId);
      }
      return kitchenJson({ error: "No pude preparar el envío." }, 502);
    }

    return kitchenJson(
      serializeKitchenUploadTicket({
        reportId: report.reportId,
        uploadUrl: signed.signedUrl,
        uploadToken: signed.token,
        path,
        expiresInS: KITCHEN_MEDIA_SIGNED_UPLOAD_TTL_S,
        duplicate: report.duplicate,
      }),
      report.duplicate ? 200 : 201
    );
  } catch (err) {
    console.error(
      "[mobile-kitchen-uploads] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return kitchenJson({ error: "No pude preparar el envío." }, 500);
  }
}
