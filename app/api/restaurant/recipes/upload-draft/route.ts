// /api/restaurant/recipes/upload-draft
//
// The cost-file upload as a draft that survives leaving the page.
//   GET              → { draft } (no file bytes) or { draft: null }
//   POST multipart   → file: a newly picked file replaces the draft
//   PATCH JSON       → { decisions?, catalog_result?: null, recipes_result?: null }
//   DELETE           → discard the draft
// Company and user come from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  MAX_DRAFT_FILE_BYTES,
  deleteUploadDraft,
  loadUploadDraft,
  parseDraftDecisions,
  saveUploadDraftFile,
  updateUploadDraft,
} from "@/lib/restaurant/price-catalog/draft";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NEEDS_044 =
  "Falta aplicar la migración 044 en Supabase para guardar tu avance.";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({
      draft: await loadUploadDraft(auth.supabase, auth.companyId),
    });
  } catch (err) {
    console.error("[recipes/upload-draft GET]", err);
    return NextResponse.json(
      { error: "No pude recuperar tu avance." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Sube el archivo de costos (.xlsx)." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Sube el archivo de costos (.xlsx)." },
      { status: 400 }
    );
  }
  if (file.size > MAX_DRAFT_FILE_BYTES) {
    return NextResponse.json(
      { error: "El archivo pesa más de 15 MB." },
      { status: 400 }
    );
  }
  try {
    const saved = await saveUploadDraftFile(auth.supabase, {
      companyId: auth.companyId,
      userId: auth.userId,
      filename: file.name || "archivo de costos.xlsx",
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    if (!saved.ok) {
      if (saved.missingTable) {
        return NextResponse.json({ error: NEEDS_044 }, { status: 400 });
      }
      throw new Error(saved.error);
    }
    return NextResponse.json({
      draft: await loadUploadDraft(auth.supabase, auth.companyId),
    });
  } catch (err) {
    console.error("[recipes/upload-draft POST]", err);
    return NextResponse.json(
      { error: "No pude guardar tu archivo." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  try {
    await updateUploadDraft(auth.supabase, {
      companyId: auth.companyId,
      userId: auth.userId,
      ...(body.decisions !== undefined
        ? { decisions: parseDraftDecisions(body.decisions) }
        : {}),
      // The client can only clear a result (after "Deshacer"), never set one.
      ...(body.catalog_result === null ? { catalog_result: null } : {}),
      ...(body.recipes_result === null ? { recipes_result: null } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recipes/upload-draft PATCH]", err);
    return NextResponse.json(
      { error: "No pude guardar tu avance." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  try {
    await deleteUploadDraft(auth.supabase, auth.companyId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recipes/upload-draft DELETE]", err);
    return NextResponse.json(
      { error: "No pude descartar el archivo." },
      { status: 500 }
    );
  }
}
