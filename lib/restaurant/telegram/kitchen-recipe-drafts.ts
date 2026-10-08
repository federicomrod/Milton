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

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const RECIPE_KEYWORDS = [/\breceta\b/i];

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

const SPANISH_NUMBER_WORDS = Object.keys(SPANISH_NUMBERS).join("|");
const SPANISH_NUMBER_PATTERN = `\\d+|${SPANISH_NUMBER_WORDS}`;
const NUMBER_TOKEN = `\\b(?:${SPANISH_NUMBER_PATTERN})\\b`;
const NUMBER_WORD_TOKEN = `\\b(?:${SPANISH_NUMBER_WORDS})\\b`;

const PORTIONS_WITH_NUMBER = new RegExp(
  `\\b(?:salio|salieron)\\s+(?:para\\s+${NUMBER_TOKEN}|${NUMBER_TOKEN}\\s+porcion(?:es)?)`
);
const PORTIONS_ONLY = new RegExp(
  `(?:${NUMBER_WORD_TOKEN}|\\b\\d+)\\s*porcion(?:es)?`
);

const WASTE_RE =
  /merma|\btir(?:e|amos|aron|ado)|\bbot(?:e|amos)\b|se quem|quemad|caduc|venci|se paso|se dano/;
const EIGHTY_SIX_RE =
  /\b86\b|se acab(?:o|aron)|(?<!casi )no (?:hay|queda)|agotad|nos quedamos sin|^\s*sin\s+\S+/;
const RUNNING_OUT_RE =
  /queda(?:n)? poco|se esta acabando|casi no (?:hay|queda)|quedan para|ultim[oa]s?/;
const REPORT_PORTIONS_RE = new RegExp(
  `\\bqueda(?:n)?\\s+${NUMBER_TOKEN}\\s+porcion(?:es)?`
);

function hasReportKeywords(normalizedText: string): boolean {
  return (
    WASTE_RE.test(normalizedText) ||
    EIGHTY_SIX_RE.test(normalizedText) ||
    RUNNING_OUT_RE.test(normalizedText) ||
    REPORT_PORTIONS_RE.test(normalizedText)
  );
}

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

  const normalized = normalize(text);

  if (hasReportKeywords(normalized)) {
    return { isRecipe: false, portions: null, dishName: null };
  }

  const hasRecipeKeyword = RECIPE_KEYWORDS.some((re) => re.test(normalized));
  const hasPortionsWithNumber = PORTIONS_WITH_NUMBER.test(normalized);
  const hasPortionsOnly = PORTIONS_ONLY.test(normalized);

  if (hasRecipeKeyword || hasPortionsWithNumber || hasPortionsOnly) {
    const portions = parsePortions(text);
    return { isRecipe: true, portions, dishName: null };
  }

  return { isRecipe: false, portions: null, dishName: null };
}

function parseNumberToken(token: string): number | null {
  if (/^\d+$/.test(token)) return parseInt(token, 10);
  return SPANISH_NUMBERS[token] ?? null;
}

export function parsePortions(text: string): number | null {
  const normalized = normalize(text);

  const porcionMatch = normalized.match(
    new RegExp(
      `(?:\\b(${SPANISH_NUMBER_WORDS})\\b|\\b(\\d+))\\s*porcion(?:es)?`
    )
  );
  if (porcionMatch) {
    const token = porcionMatch[1] ?? porcionMatch[2];
    if (token) return parseNumberToken(token);
  }

  const forMatch = normalized.match(
    new RegExp(
      `(?:salio|salieron)\\s+para\\s+\\b(${SPANISH_NUMBER_PATTERN})\\b`
    )
  );
  if (forMatch) return parseNumberToken(forMatch[1]);

  return null;
}

export function parseDishName(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null;
  const trimmed = text.trim();
  const normalized = normalize(trimmed);

  const patterns = [
    /(?:salio|salieron)\s+para\s+\d+\s+porcion(?:es)?\s+de\s+(.+)$/,
    /(?:salio|salieron)\s+para\s+\d+\s+de\s+(.+)$/,
    /\d+\s+porcion(?:es)?\s+de\s+(.+)$/,
    /\breceta\s+(?:de\s+)?(.+)$/,
  ];
  for (const re of patterns) {
    const match = normalized.match(re);
    const captured = match?.[1]?.trim();
    if (captured && captured.length > 0 && captured.length <= 80) {
      return trimmed.slice(trimmed.length - captured.length).trim();
    }
  }

  if (trimmed.length <= 40) return trimmed;
  return null;
}

export function parsePortionsFromFollowUp(text: string): number | null {
  const normalized = normalize(text.trim());
  const portionsRe =
    /^\s*(?:\b(\d{1,3})|\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b)(?:\s*porcion(?:es)?)?\s*\.?\s*$/;
  const match = normalized.match(portionsRe);
  if (!match) return null;

  const value = match[1] ?? match[2];
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  return SPANISH_NUMBERS[value] ?? null;
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

function buildExtractionUserPrompt(
  caption: string | null,
  isPhoto: boolean
): string {
  let prompt = `Extrae el nombre del platillo, número de porciones, e ingredientes con cantidades de esta receta.`;
  if (caption && caption.trim()) {
    prompt += `\n\nContexto del cocinero: ${caption}`;
  }
  return prompt;
}

async function callOpenAIVision(
  imageDataUrl: string,
  caption: string | null
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
    console.error("[recipe-drafts] openai sdk import failed");
    return { ok: false, error: "OpenAI SDK unavailable" };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK unavailable" };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAIctor({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 20000,
    maxRetries: 0,
  });

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
            { type: "text", text: buildExtractionUserPrompt(caption, true) },
            {
              type: "image_url",
              image_url: { url: imageDataUrl, detail: "low" },
            },
          ],
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      return { ok: false, error: "No content" };
    }
    const parsed = JSON.parse(raw);
    if (!validateExtractedRecipe(parsed)) {
      return { ok: false, error: "Invalid JSON structure" };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    console.error("[recipe-drafts] vision call failed");
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
    console.error("[recipe-drafts] openai sdk import failed");
    return { ok: false, error: "OpenAI SDK unavailable" };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK unavailable" };
  }

  const client = new OpenAIctor({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 20000,
    maxRetries: 0,
  });

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
    console.error("[recipe-drafts] voice processing failed");
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
    console.error("[recipe-drafts] openai sdk import failed");
    return { ok: false, error: "OpenAI SDK unavailable" };
  }
  if (!OpenAIctor) {
    return { ok: false, error: "OpenAI SDK unavailable" };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAIctor({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 20000,
    maxRetries: 0,
  });

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${buildExtractionUserPrompt(text, false)}\n\n${text}`,
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      return { ok: false, error: "No content" };
    }
    const parsed = JSON.parse(raw);
    if (!validateExtractedRecipe(parsed)) {
      return { ok: false, error: "Invalid JSON structure" };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    console.error("[recipe-drafts] extraction failed");
    return { ok: false, error: "Text extraction failed" };
  }
}

export function validateExtractedRecipe(
  data: unknown
): data is ExtractedRecipe {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (typeof d.dish_name !== "string") return false;
  if (d.portions !== null && typeof d.portions !== "number") return false;
  if (typeof d.portions === "number") {
    if (d.portions <= 0 || !Number.isInteger(d.portions)) return false;
  }
  if (!Array.isArray(d.ingredients)) return false;
  if (!["high", "medium", "low"].includes(d.overall_confidence as string))
    return false;

  for (const ing of d.ingredients) {
    if (typeof ing !== "object" || !ing) return false;
    const i = ing as Record<string, unknown>;
    if (typeof i.name !== "string") return false;
    if (
      i.estimated_quantity !== null &&
      typeof i.estimated_quantity !== "number"
    )
      return false;
    if (i.unit !== null && typeof i.unit !== "string") return false;
    if (!["high", "medium", "low"].includes(i.confidence as string))
      return false;
  }
  return true;
}

const KITCHEN_SYNONYMS: Record<string, string> = {
  tomate: "jitomate",
  jitomate: "tomate",
  papa: "patata",
  patata: "papa",
  chile: "chili",
  chili: "chile",
  elote: "maiz",
  maiz: "elote",
};

function isSpanishConsonant(ch: string): boolean {
  return /[bcdfghjklmnpqrstvwxyz]/.test(ch);
}

function singularizeSpanishWord(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("es")) {
    const stem = word.slice(0, -2);
    const stemEnd = stem.charAt(stem.length - 1);
    if (stemEnd && isSpanishConsonant(stemEnd)) {
      return stem;
    }
  }
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function kitchenWordVariants(word: string): Set<string> {
  const singular = singularizeSpanishWord(word);
  const variants = new Set<string>([word, singular]);
  for (const form of [word, singular]) {
    const synonym = KITCHEN_SYNONYMS[form];
    if (synonym) {
      variants.add(synonym);
      variants.add(singularizeSpanishWord(synonym));
    }
  }
  return variants;
}

function kitchenWordsMatch(cookWord: string, catalogWord: string): boolean {
  if (cookWord.length < 3) return false;
  const catalogVariants = kitchenWordVariants(catalogWord);
  for (const variant of kitchenWordVariants(cookWord)) {
    if (catalogVariants.has(variant)) return true;
  }
  return false;
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
  unit_cost_unit: string | null;
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
    if (!line.name || !line.name.trim()) continue;

    const normName = normalize(line.name);
    let bestMatch: CostingIngredient | null = null;
    let matchConfidence: "high" | "medium" | "low" = line.confidence;

    for (const ing of companyIngredients) {
      const ingNorm = normalize(ing.name);
      if (ingNorm === normName) {
        bestMatch = ing;
        matchConfidence = line.confidence;
        break;
      }
    }

    if (!bestMatch && normName.length >= 3) {
      for (const ing of companyIngredients) {
        const ingNorm = normalize(ing.name);
        const words = normName.split(/\s+/);
        const ingWords = ingNorm.split(/\s+/);

        const hasWholeWordMatch = words.some((w) =>
          ingWords.some((iw) => kitchenWordsMatch(w, iw))
        );

        if (hasWholeWordMatch) {
          bestMatch = ing;
          matchConfidence = "medium";
          break;
        }
      }
    }

    const perPortion =
      line.estimated_quantity !== null && portions && portions > 0
        ? line.estimated_quantity / portions
        : null;

    let unitCost: number | null = null;
    let unitCostUnit: string | null = null;
    let lineCost: number | null = null;
    let finalConfidence = matchConfidence;

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
        unitCostUnit = cost.unit;
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

      if (lineCost === null) {
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
      unit_cost_unit: unitCostUnit,
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
      .insert({
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
      })
      .select("id")
      .single();

    if (draftError) {
      if (draftError.code === "23505") {
        return { ok: false, error: "duplicate" };
      }
      console.error("[recipe-drafts] draft insert failed");
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
      unit_cost_unit: l.unit_cost_unit,
      line_cost: l.line_cost,
    }));

    if (lineRows.length > 0) {
      const { error: insertError } = await admin
        .from("kitchen_recipe_draft_lines")
        .insert(lineRows);

      if (insertError) {
        console.error("[recipe-drafts] lines insert failed");
      }
    }

    return { ok: true, draftId: draft.id };
  } catch (err) {
    console.error("[recipe-drafts] create failed");
    return { ok: false, error: "Create failed" };
  }
}

export async function updateDraftPortions(
  chatId: number,
  staffId: string,
  portions: number
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  try {
    const admin = createAdminClient();

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: draft, error: findError } = await admin
      .from("kitchen_recipe_drafts")
      .select("id, total_cost")
      .eq("telegram_chat_id", chatId)
      .eq("staff_id", staffId)
      .eq("status", "awaiting_portions")
      .gte("created_at", twoHoursAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError || !draft) {
      return { ok: false, error: "No awaiting draft" };
    }

    const perPortionCost =
      portions > 0 && draft.total_cost ? draft.total_cost / portions : null;

    const { data: updated, error: updateError } = await admin
      .from("kitchen_recipe_drafts")
      .update({
        portions,
        per_portion_cost: perPortionCost,
        status: "draft",
      })
      .eq("id", draft.id)
      .eq("status", "awaiting_portions")
      .select("id")
      .single();

    if (updateError || !updated) {
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
          })
          .eq("id", line.id);
      }
    }

    return { ok: true, draftId: draft.id };
  } catch (err) {
    console.error("[recipe-drafts] update portions failed");
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

  const parsedPortions = input.text ? parsePortions(input.text) : null;

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
      const result = await callOpenAIVision(dataUrl, input.text);
      if (result.ok) {
        extracted = result.data;
        if (parsedPortions !== null) {
          extracted.portions = parsedPortions;
        }
      }
    }
  } else if (input.text) {
    // Voice is transcribed once in the webhook after() work and passed here
    // as text, so we must not transcribe again.
    const result = await extractFromText(input.text);
    if (result.ok) {
      extracted = result.data;
      if (extracted.portions == null && parsedPortions !== null) {
        extracted.portions = parsedPortions;
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
          const fromTranscript = parsePortions(transcription.text);
          if (extracted.portions == null && fromTranscript !== null) {
            extracted.portions = fromTranscript;
          }
        }
      }
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
      dishName: parseDishName(input.text) || "Receta",
      portions: parsedPortions,
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
  let overallConfidence = extracted.overall_confidence;
  if (overallConfidence !== "low" && (hasUnmatched || hasLowConf)) {
    overallConfidence = "low";
  }

  const currencies = new Set(
    matched
      .map((l) => {
        if (!l.ingredient_id) return null;
        const entries = costEntriesByIngredientId.get(l.ingredient_id);
        return entries?.[0]?.currency ?? null;
      })
      .filter((c): c is string => c !== null)
  );

  let currency = input.currency;
  if (currencies.size === 1) {
    currency = Array.from(currencies)[0];
  } else if (currencies.size > 1) {
    overallConfidence = "low";
  }

  const caption = input.text?.trim() ?? "";
  const modelName = extracted.dish_name?.trim() ?? "";
  let dishName = "Receta";
  if (modelName && modelName !== caption) {
    dishName = modelName;
  } else {
    dishName = parseDishName(input.text) || "Receta";
  }

  const draft: CreateDraftInput = {
    companyId: input.companyId,
    locationId: input.locationId,
    staffId: input.staffId,
    kitchenReportId: input.kitchenReportId,
    chatId: input.chatId,
    messageId: input.messageId,
    dishName,
    portions,
    lines: matched,
    overallConfidence,
    currency,
  };

  return await createRecipeDraft(draft);
}
