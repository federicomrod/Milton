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
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_USER_INSTRUCTION,
  enrichExtraction,
  isExtractedInvoice,
  normalizeExtraction,
  type ExtractedInvoice,
} from "@/lib/restaurant/invoice-extraction";

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
// OpenAI vision call (isolated so any failure surfaces cleanly to the UI)
// ---------------------------------------------------------------------------

async function callOpenAIVision(
  imageDataUrl: string
): Promise<
  { ok: true; data: ExtractedInvoice } | { ok: false; error: string }
> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      error: "OpenAI API key is not configured on the server.",
    };
  }

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch (err) {
    console.error("[invoices/extract] openai sdk import failed:", err);
    return { ok: false, error: "Could not load OpenAI SDK on the server." };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK is unavailable." };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAIctor({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_USER_INSTRUCTION },
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "high" },
            },
          ],
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      return { ok: false, error: "Model returned no content." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        error: "Model output was not valid JSON. Try a clearer image.",
      };
    }
    if (!isExtractedInvoice(parsed)) {
      return {
        ok: false,
        error: "Model output did not match the invoice extraction schema.",
      };
    }
    return { ok: true, data: normalizeExtraction(parsed) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown OpenAI error";
    console.error("[invoices/extract] openai call failed:", msg);
    return { ok: false, error: `OpenAI call failed: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  // ---- Form parsing ----
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Body must be multipart/form-data" },
      { status: 400 }
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)` },
      { status: 400 }
    );
  }

  // ---- File type gate ----
  const mime = (file.type || "").toLowerCase();
  if (PDF_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      {
        error:
          "PDF extraction will be added next; image upload works now. Export the page as a PNG/JPG and try again.",
      },
      { status: 415 }
    );
  }
  if (!IMAGE_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      {
        error:
          "Unsupported file type. Use PNG, JPG, or WEBP. (PDF support is coming next.)",
      },
      { status: 415 }
    );
  }

  // ---- Build the data URL for the vision request ----
  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

  // ---- Extract ----
  const result = await callOpenAIVision(dataUrl);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Enrich with per-line flags + cheap derivations (missing_*, derived_*,
  // low_confidence). The UI consumes the enriched shape; /from-extraction
  // accepts it too (the extra flags are ignored at insert time).
  const enriched = enrichExtraction(result.data);

  return NextResponse.json({
    extraction: enriched,
    original_file_name: file.name,
    source_type: "image",
  });
}
