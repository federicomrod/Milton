// lib/restaurant/telegram/kitchen-recipe-drafts.ts
//
// Recipe draft extraction from cook photos/voice/text (R1 #72 / #18):
// AI-powered ingredient extraction, matching to the company's catalog,
// per-portion costing, and draft management. Server-only (uses OpenAI).
//
// SECURITY: never logs message text, file ids, transcripts, bot tokens,
// Bot API URLs or OpenAI keys. Follows the same rules as files.ts.

import { createAdminClient } from "@/lib/supabase/admin";
import { getLatestIngredientCost } from "@/lib/restaurant/costing";
import { convertUnitStr, normalizeUnit } from "@/lib/restaurant/units";
import type { CostingData, CostingIngredient } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";

const RECIPE_KEYWORDS = [
  /\breceta\b/i,
  /\bporcion(?:es)?\b/i,
  /sali(?:o|eron)\s+para\s+\d+/i,
  /para\s+\d+\s+porcion(?:es)?/i,
];

const SPANISH_NUMBERS: Record<string, number> = {
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

export interface RecipeIntentResult {
  isRecipe: boolean;
  portions: number | null;
  dishName: string | null;
}

export function detectRecipeIntent(
  text: string | null | undefined
): RecipeIntentResult {
  if (!text || !text.trim()) {
    return { isRecipe: false, portions: null, dishName: null };
  }

  const hasKeyword = RECIPE_KEYWORDS.some((re) => re.test(text));
  if (!hasKeyword) {
    return { isRecipe: false, portions: null, dishName: null };
  }

  const portions = parsePortions(text);
  return { isRecipe: true, portions, dishName: null };
}

export function parsePortions(text: string): number | null {
  const digitMatch = text.match(/\b(\d+)\s*porcion(?:es)?/i);
  if (digitMatch) return parseInt(digitMatch[1], 10);

  const forMatch = text.match(/para\s+(\d+)/i);
  if (forMatch) return parseInt(forMatch[1], 10);

  for (const [word, num] of Object.entries(SPANISH_NUMBERS)) {
    const re = new RegExp(`\\b${word}\\s+porcion(?:es)?`, "i");
    if (re.test(text)) return num;
  }

  return null;
}

export interface ExtractedIngredientLine {
  name: string;
  estimated_quantity: number | null;
  unit: string | null;
  confidence: "high" | "medium" | "low";
}

export interface ExtractedRecipe {
  dish_name: string;
  portions: number | null;
  ingredients: ExtractedIngredientLine[];
  overall_confidence: "high" | "medium" | "low";
}

const EXTRACTION_SYSTEM_PROMPT = `Eres un asistente de cocina experto en recetas de restaurantes mexicanos. Extrae la información estructurada de una receta: nombre del platillo, número de porciones, y lista de ingredientes con cantidades estimadas. Responde siempre en JSON con esta estructura exacta:

{
  "dish_name": "nombre del platillo",
  "portions": número o null,
  "ingredients": [
    {"name": "ingrediente", "estimated_quantity": número o null, "unit": "g/kg/ml/l/pza/unidad" o null, "confidence": "high/medium/low"}
  ],
  "overall_confidence": "high/medium/low"
}

Reglas:
- Usa unidades métricas (g, kg, ml, l) o piezas (pza, unidad).
- Si no puedes estimar una cantidad, pon null.
- Marca confidence "low" si hay ambigüedad o falta información.
- Extrae SOLO lo visible o mencionado, nunca inventes.`;

const EXTRACTION_USER_INSTRUCTION = `Extrae el nombre del platillo, número de porciones, e ingredientes con cantidades de esta receta.`;

async function callOpenAIVision(
  imageDataUrl: string
): Promise<{ ok: true; data: ExtractedRecipe } | { ok: false; error: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OpenAI not configured" };
  }

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch (err) {
    console.error("[recipe-drafts] openai sdk import failed:", err);
    return { ok: false, error: "OpenAI SDK unavailable" };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK unavailable" };
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
      return { ok: false, error: "No content" };
    }
    const parsed = JSON.parse(raw) as ExtractedRecipe;
    return { ok: true, data: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.name : "Unknown";
    console.error("[recipe-drafts] vision call failed:", msg);
    return { ok: false, error: "Vision call failed" };
  }
}

async function transcribeVoice(
  audioBytes: Buffer
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OpenAI not configured" };
  }

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch (err) {
    console.error("[recipe-drafts] openai sdk import failed:", err);
    return { ok: false, error: "OpenAI SDK unavailable" };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK unavailable" };
  }

  const client = new OpenAIctor({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const uint8Array = new Uint8Array(audioBytes);
    const blob = new Blob([uint8Array], { type: "audio/ogg" });
    const file = new File([blob], "voice.ogg", { type: "audio/ogg" });
    const transcription = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "es",
    });
    return { ok: true, text: transcription.text };
  } catch (err) {
    const msg = err instanceof Error ? err.name : "Unknown";
    console.error("[recipe-drafts] transcription failed:", msg);
    return { ok: false, error: "Transcription failed" };
  }
}

async function extractFromText(
  text: string
): Promise<{ ok: true; data: ExtractedRecipe } | { ok: false; error: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OpenAI not configured" };
  }

  let OpenAIctor: typeof import("openai").OpenAI;
  try {
    const mod = await import("openai");
    OpenAIctor =
      mod.OpenAI ??
      (mod as unknown as { default: typeof import("openai").OpenAI }).default;
  } catch (err) {
    console.error("[recipe-drafts] openai sdk import failed:", err);
    return { ok: false, error: "OpenAI SDK unavailable" };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK unavailable" };
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
          content: `${EXTRACTION_USER_INSTRUCTION}\n\n${text}`,
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      return { ok: false, error: "No content" };
    }
    const parsed = JSON.parse(raw) as ExtractedRecipe;
    return { ok: true, data: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.name : "Unknown";
    console.error("[recipe-drafts] text extraction failed:", msg);
    return { ok: false, error: "Text extraction failed" };
  }
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface MatchedIngredientLine {
  raw_name: string;
  ingredient_id: string | null;
  ingredient_name: string | null;
  total_quantity: number | null;
  unit: string | null;
  per_portion_quantity: number | null;
  confidence: "high" | "medium" | "low";
  unit_cost_snapshot: number | null;
  line_cost: number | null;
}

export function matchIngredients(
  lines: ExtractedIngredientLine[],
  companyIngredients: CostingIngredient[],
  costEntriesByIngredientId: Map<string, IngredientCostEntry[]>,
  portions: number | null
): MatchedIngredientLine[] {
  const matched: MatchedIngredientLine[] = [];

  for (const line of lines) {
    const normName = normalize(line.name);
    let bestMatch: CostingIngredient | null = null;

    for (const ing of companyIngredients) {
      if (normalize(ing.name) === normName) {
        bestMatch = ing;
        break;
      }
    }

    if (!bestMatch) {
      for (const ing of companyIngredients) {
        if (
          normalize(ing.name).includes(normName) ||
          normName.includes(normalize(ing.name))
        ) {
          bestMatch = ing;
          break;
        }
      }
    }

    const perPortion =
      line.estimated_quantity !== null && portions && portions > 0
        ? line.estimated_quantity / portions
        : null;

    let unitCost: number | null = null;
    let lineCost: number | null = null;
    let finalConfidence = line.confidence;

    if (bestMatch) {
      const costData: CostingData = {
        ingredientsById: new Map(companyIngredients.map((i) => [i.id, i])),
        componentsById: new Map(),
        componentRecipesByComponentId: new Map(),
        componentRecipeInputsByRecipeId: new Map(),
        menuItemsById: new Map(),
        menuRecipesByMenuItemId: new Map(),
        menuRecipeInputsByRecipeId: new Map(),
        costEntriesByIngredientId,
      };

      const cost = getLatestIngredientCost(bestMatch.id, costData);
      if (cost.status === "complete" && cost.unit_cost !== null && cost.unit) {
        unitCost = cost.unit_cost;
        if (
          line.estimated_quantity !== null &&
          line.unit &&
          normalizeUnit(line.unit) !== null &&
          normalizeUnit(cost.unit) !== null
        ) {
          const converted = convertUnitStr(
            line.estimated_quantity,
            line.unit,
            cost.unit
          );
          if (converted.ok) {
            lineCost = converted.value * cost.unit_cost;
          } else {
            finalConfidence = "low";
          }
        }
      } else {
        finalConfidence = "low";
      }
    } else {
      finalConfidence = "low";
    }

    matched.push({
      raw_name: line.name,
      ingredient_id: bestMatch?.id ?? null,
      ingredient_name: bestMatch?.name ?? null,
      total_quantity: line.estimated_quantity,
      unit: line.unit,
      per_portion_quantity: perPortion,
      confidence: finalConfidence,
      unit_cost_snapshot: unitCost,
      line_cost: lineCost,
    });
  }

  return matched;
}

export interface CreateDraftInput {
  companyId: string;
  locationId: string;
  staffId: string;
  kitchenReportId: string | null;
  chatId: number;
  messageId: number;
  dishName: string;
  portions: number | null;
  lines: MatchedIngredientLine[];
  overallConfidence: "high" | "medium" | "low";
  currency: string;
}

export async function createRecipeDraft(
  input: CreateDraftInput
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  try {
    const admin = createAdminClient();

    const totalCost = input.lines.reduce(
      (sum, l) => sum + (l.line_cost ?? 0),
      0
    );
    const perPortionCost =
      input.portions && input.portions > 0 ? totalCost / input.portions : null;

    const status = input.portions === null ? "awaiting_portions" : "draft";

    const { data: draft, error: draftError } = await admin
      .from("kitchen_recipe_drafts")
      .upsert(
        {
          company_id: input.companyId,
          location_id: input.locationId,
          staff_id: input.staffId,
          kitchen_report_id: input.kitchenReportId,
          telegram_chat_id: input.chatId,
          telegram_message_id: input.messageId,
          dish_name: input.dishName,
          portions: input.portions,
          status,
          confidence: input.overallConfidence,
          total_cost: totalCost,
          per_portion_cost: perPortionCost,
          currency: input.currency,
        },
        {
          onConflict: "telegram_chat_id,telegram_message_id",
          ignoreDuplicates: false,
        }
      )
      .select("id")
      .single();

    if (draftError) {
      console.error("[recipe-drafts] draft insert failed:", draftError.message);
      return { ok: false, error: "Draft insert failed" };
    }

    const lineRows = input.lines.map((l, idx) => ({
      draft_id: draft.id,
      company_id: input.companyId,
      line_number: idx + 1,
      raw_name: l.raw_name,
      ingredient_id: l.ingredient_id,
      total_quantity: l.total_quantity,
      unit: l.unit,
      per_portion_quantity: l.per_portion_quantity,
      confidence: l.confidence,
      unit_cost_snapshot: l.unit_cost_snapshot,
      line_cost: l.line_cost,
    }));

    if (lineRows.length > 0) {
      const { error: linesError } = await admin
        .from("kitchen_recipe_draft_lines")
        .delete()
        .eq("draft_id", draft.id);

      if (linesError) {
        console.error(
          "[recipe-drafts] lines delete failed:",
          linesError.message
        );
      }

      const { error: insertError } = await admin
        .from("kitchen_recipe_draft_lines")
        .insert(lineRows);

      if (insertError) {
        console.error(
          "[recipe-drafts] lines insert failed:",
          insertError.message
        );
      }
    }

    return { ok: true, draftId: draft.id };
  } catch (err) {
    console.error(
      "[recipe-drafts] create failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return { ok: false, error: "Create failed" };
  }
}

export async function updateDraftPortions(
  chatId: number,
  portions: number
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  try {
    const admin = createAdminClient();

    const { data: draft, error: findError } = await admin
      .from("kitchen_recipe_drafts")
      .select("id, total_cost")
      .eq("telegram_chat_id", chatId)
      .eq("status", "awaiting_portions")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError || !draft) {
      return { ok: false, error: "No awaiting draft" };
    }

    const perPortionCost =
      portions > 0 && draft.total_cost ? draft.total_cost / portions : null;

    const { error: updateError } = await admin
      .from("kitchen_recipe_drafts")
      .update({
        portions,
        per_portion_cost: perPortionCost,
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    if (updateError) {
      console.error(
        "[recipe-drafts] portions update failed:",
        updateError.message
      );
      return { ok: false, error: "Update failed" };
    }

    const { data: lines, error: linesError } = await admin
      .from("kitchen_recipe_draft_lines")
      .select("id, total_quantity")
      .eq("draft_id", draft.id);

    if (!linesError && lines) {
      for (const line of lines) {
        const perPortion =
          line.total_quantity !== null ? line.total_quantity / portions : null;
        await admin
          .from("kitchen_recipe_draft_lines")
          .update({
            per_portion_quantity: perPortion,
            updated_at: new Date().toISOString(),
          })
          .eq("id", line.id);
      }
    }

    return { ok: true, draftId: draft.id };
  } catch (err) {
    console.error(
      "[recipe-drafts] update portions failed:",
      err instanceof Error ? err.message : "Unknown"
    );
    return { ok: false, error: "Update failed" };
  }
}

export interface ExtractRecipeInput {
  companyId: string;
  locationId: string;
  staffId: string;
  kitchenReportId: string | null;
  chatId: number;
  messageId: number;
  mediaKind: "photo" | "voice" | null;
  telegramFileId: string | null;
  text: string | null;
  currency: string;
}

export async function extractAndCreateRecipeDraft(
  input: ExtractRecipeInput,
  companyIngredients: CostingIngredient[],
  costEntriesByIngredientId: Map<string, IngredientCostEntry[]>
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  let extracted: ExtractedRecipe | null = null;

  if (input.mediaKind === "photo" && input.telegramFileId) {
    const { openTelegramFile } =
      await import("@/lib/restaurant/telegram/files");
    const stream = await openTelegramFile(input.telegramFileId);
    if (stream.ok) {
      const chunks: Uint8Array[] = [];
      const reader = stream.body.getReader();
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (value) chunks.push(value);
        done = readerDone;
      }
      const buffer = Buffer.concat(chunks);
      const dataUrl = `data:image/jpeg;base64,${buffer.toString("base64")}`;
      const result = await callOpenAIVision(dataUrl);
      if (result.ok) {
        extracted = result.data;
      }
    }
  } else if (input.mediaKind === "voice" && input.telegramFileId) {
    const { openTelegramFile } =
      await import("@/lib/restaurant/telegram/files");
    const stream = await openTelegramFile(input.telegramFileId);
    if (stream.ok) {
      const chunks: Uint8Array[] = [];
      const reader = stream.body.getReader();
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (value) chunks.push(value);
        done = readerDone;
      }
      const buffer = Buffer.concat(chunks);
      const transcription = await transcribeVoice(buffer);
      if (transcription.ok && transcription.text) {
        const result = await extractFromText(transcription.text);
        if (result.ok) {
          extracted = result.data;
        }
      }
    }
  } else if (input.text) {
    const result = await extractFromText(input.text);
    if (result.ok) {
      extracted = result.data;
    }
  }

  if (!extracted) {
    const fallbackDraft: CreateDraftInput = {
      companyId: input.companyId,
      locationId: input.locationId,
      staffId: input.staffId,
      kitchenReportId: input.kitchenReportId,
      chatId: input.chatId,
      messageId: input.messageId,
      dishName: "Receta sin procesar",
      portions: null,
      lines: [],
      overallConfidence: "low",
      currency: input.currency,
    };
    return await createRecipeDraft(fallbackDraft);
  }

  const portions = extracted.portions;
  const matched = matchIngredients(
    extracted.ingredients,
    companyIngredients,
    costEntriesByIngredientId,
    portions
  );

  const hasUnmatched = matched.some((l) => l.ingredient_id === null);
  const hasLowConf = matched.some((l) => l.confidence === "low");
  const overallConfidence =
    extracted.overall_confidence === "low" || hasUnmatched || hasLowConf
      ? "low"
      : extracted.overall_confidence;

  const draft: CreateDraftInput = {
    companyId: input.companyId,
    locationId: input.locationId,
    staffId: input.staffId,
    kitchenReportId: input.kitchenReportId,
    chatId: input.chatId,
    messageId: input.messageId,
    dishName: extracted.dish_name || "Receta",
    portions,
    lines: matched,
    overallConfidence,
    currency: input.currency,
  };

  return await createRecipeDraft(draft);
}
