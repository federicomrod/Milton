// app/api/restaurant/invoices/extract/route.ts
//
// POST /api/restaurant/invoices/extract
//
// Accepts a multipart upload of an invoice IMAGE (PNG/JPG/WEBP) and uses an
// OpenAI vision-capable model to extract supplier-invoice fields. The route
// is read-only — no DB writes happen here. The extracted JSON is validated
// against the schema in lib/restaurant/invoice-extraction.ts and returned to
// the UI as a draft. Persisting the invoice is a second, explicit step via
// POST /api/restaurant/invoices/from-extraction.
//
// Safety:
//   * OpenAI key is read from server env only and never echoed.
//   * The model is instructed to use only what's visibly on the invoice
//     and to return null for anything unclear. See the system prompt.
//   * Model output is parsed AND schema-checked; failures return a clean
//     400/502 without persisting anything.
//   * No DB context is sent to the model — the prompt knows nothing about
//     the user's catalog. Matching happens later, deterministically.
//
// PDF: not extracted in this milestone. Returns 415 with a clear message
// (rendering PDF → image server-side requires pdf.js or pdf2pic plus a
// runtime image library; deferring per the brief).

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { extractInvoiceFromImage } from "@/lib/restaurant/invoice-draft";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — vision uploads are large

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const PDF_MIME_TYPES = new Set(["application/pdf"]);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "prices.edit");
  if (denied) return denied;

  // ---- Form parsing ----
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser multipart/form-data." },
      { status: 400 }
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Sube un archivo." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: "El archivo está vacío." },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `El archivo pesa más de ${MAX_FILE_BYTES / 1024 / 1024} MB.` },
      { status: 400 }
    );
  }

  // ---- File type gate ----
  const mime = (file.type || "").toLowerCase();
  if (PDF_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      {
        error: "Todavía no leo PDF; sube una foto PNG o JPG.",
      },
      { status: 415 }
    );
  }
  if (!IMAGE_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      {
        error: "Ese tipo de archivo no sirve. Usa PNG, JPG o WEBP.",
      },
      { status: 415 }
    );
  }

  // ---- Build the data URL for the vision request ----
  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

  // ---- Extract (vision call + enrichment live in lib/restaurant/invoice-draft) ----
  const result = await extractInvoiceFromImage({ dataUrl });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 502 });
  }

  return NextResponse.json({
    extraction: result.extraction,
    original_file_name: file.name,
    source_type: "image",
  });
}
