// app/api/restaurant/kitchen/recipe-upload/route.ts
//
// POST /api/restaurant/kitchen/recipe-upload
//
// «Sube tus recetas»: ONE file per request (xlsx, csv, docx, pdf or a photo)
// plus an optional location_id. Everything it creates is a DRAFT in
// kitchen_recipe_drafts: it never touches recipes, versions or the menu.
// Confirming stays the existing path.
//
// Order matters: auth -> permission (before the body is read) -> size ->
// file type -> location of THIS company -> admin client -> processing.
// The company comes from the session only; a company_id in the form is ignored.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { kitchenManagerGuard } from "@/lib/restaurant/telegram/kitchen-manager-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { getDictionary } from "@/lib/i18n";
import { uploadMsg } from "@/lib/restaurant/recipe-upload/messages";
import {
  MAX_UPLOAD_BYTES,
  detectUploadKind,
  processRecipeFile,
} from "@/lib/restaurant/recipe-upload/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The multipart envelope adds a little to the file itself.
const ENVELOPE_SLACK_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const denied = await kitchenManagerGuard(auth.companyId, auth.userId);
  if (denied) return denied;

  const started = Date.now();
  const lang = await apiLanguage();
  const api = getDictionary(lang).menu.groups.api;
  const fileTooBig = uploadMsg(lang, "fileTooBig");

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declared) &&
    declared > MAX_UPLOAD_BYTES + ENVELOPE_SLACK_BYTES
  ) {
    return NextResponse.json({ error: fileTooBig }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: api.fileReadFailed }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: api.pickFile }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: fileTooBig }, { status: 413 });
  }

  const kind = detectUploadKind(file.name, file.type, lang);
  if (!kind.ok) {
    return NextResponse.json({ error: kind.error }, { status: 415 });
  }

  // The location must belong to the session's company. Read with RLS.
  const requested = form.get("location_id");
  const requestedId =
    typeof requested === "string" && requested.trim() ? requested.trim() : "";
  let locationQuery = auth.supabase
    .from("restaurant_locations")
    .select("id")
    .eq("company_id", auth.companyId);
  if (requestedId) {
    locationQuery = locationQuery.eq("id", requestedId);
  } else {
    locationQuery = locationQuery.order("name", { ascending: true });
  }
  const { data: locations, error: locError } = await locationQuery.limit(1);
  if (locError) {
    console.error("[recipe-upload] location lookup failed");
    return NextResponse.json(
      { error: api.locationCheckFailed },
      { status: 500 }
    );
  }
  const location = (locations ?? [])[0] as { id: string } | undefined;
  if (!location) {
    return NextResponse.json({ error: api.locationNotFound }, { status: 404 });
  }

  // Only now, with the permission and the location checked, the admin client.
  const admin = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await processRecipeFile({
    admin,
    companyId: auth.companyId,
    locationId: location.id,
    fileName: file.name,
    mime: file.type,
    buffer,
    lang,
  });

  console.log(
    `[recipe-upload] file processed recipes=${result.recipes_found} drafts=${result.drafts_created} ms=${Date.now() - started}`
  );
  return NextResponse.json(result);
}
