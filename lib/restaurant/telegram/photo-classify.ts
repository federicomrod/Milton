// lib/restaurant/telegram/photo-classify.ts
//
// One cheap vision call (detail "low") that decides what a caption-less photo
// from the kitchen is: a supplier invoice, a paper recipe, or something else.
// Never throws. Never logs the image, the model output or any content.

export type KitchenPhotoKind = "invoice" | "recipe" | "other";
export type KitchenPhotoConfidence = "high" | "medium" | "low";

export type ClassifyPhotoResult =
  | { ok: true; kind: KitchenPhotoKind; confidence: KitchenPhotoConfidence }
  | { ok: false; reason: "no_api_key" | "timeout" | "upstream" | "unreadable" };

export const CLASSIFY_TIMEOUT_MS = 15_000;

const SYSTEM_PROMPT =
  'You look at one photo sent by a restaurant cook. Decide what it shows. Answer ONLY with JSON: {"kind":"invoice"|"recipe"|"other","confidence":"high"|"medium"|"low"}. "invoice" = a supplier invoice, receipt or delivery note with items and prices. "recipe" = a handwritten or printed recipe (ingredients and quantities for a dish). "other" = anything else. Use "low" confidence when unsure.';

export async function classifyKitchenPhoto(
  dataUrl: string,
  timeoutMs: number = CLASSIFY_TIMEOUT_MS
): Promise<ClassifyPhotoResult> {
  if (!process.env.OPENAI_API_KEY) return { ok: false, reason: "no_api_key" };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const mod = await import("openai");
    const Ctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
    const client = new Ctor({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
    });
    const completion = await client.chat.completions.create(
      {
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        max_tokens: 40,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "What is this photo?" },
              { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
            ],
          },
        ],
      },
      { signal: controller.signal }
    );
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { kind?: unknown; confidence?: unknown };
    const kind = parsed.kind;
    const confidence = parsed.confidence;
    if (
      (kind === "invoice" || kind === "recipe" || kind === "other") &&
      (confidence === "high" || confidence === "medium" || confidence === "low")
    ) {
      return { ok: true, kind, confidence };
    }
    return { ok: false, reason: "unreadable" };
  } catch (err) {
    if (timedOut) {
      console.error("[photo-classify] timed out");
      return { ok: false, reason: "timeout" };
    }
    console.error(
      "[photo-classify] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return {
      ok: false,
      reason: err instanceof SyntaxError ? "unreadable" : "upstream",
    };
  } finally {
    clearTimeout(timer);
  }
}
