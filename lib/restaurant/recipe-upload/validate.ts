// lib/restaurant/recipe-upload/validate.ts
//
// PURE: checks what the model returned for one chunk before anything is saved.
//
//  - shape: every recipe goes through validateExtractedRecipe (the Telegram
//    validator) after being normalised;
//  - anti-invention: for a text chunk, a quantity whose number (or its fraction
//    form) is not written in the chunk becomes null with confidence «low»;
//  - lines that are not ingredients («Tiempo: …», «Porciones: …», «Tipo: …»,
//    «* nota», «Costo total»…) are dropped;
//  - a recipe left with no ingredient line is not a recipe: it goes to `ignored`.
//
// Never logs. Never returns the chunk text.

import {
  validateExtractedRecipe,
  type ExtractedIngredientLine,
  type ExtractedRecipe,
} from "@/lib/restaurant/telegram/kitchen-recipe-drafts";
import { classifyRecipeKind } from "./classify";
import { uploadMsg } from "./messages";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export type UploadRecipeKind = "plato" | "preparacion";

export type ExtractedUploadRecipe = ExtractedRecipe & {
  kind: UploadRecipeKind;
  yield_text: string | null;
  /** The tab/section the recipe came from (feeds the deterministic classifier). */
  tab_label?: string | null;
};

export interface IgnoredSection {
  name: string;
  reason: string;
}

export interface ValidatedChunk {
  recipes: ExtractedUploadRecipe[];
  ignored: IgnoredSection[];
}

export const NO_INGREDIENTS_REASON = uploadMsg("es", "noIngredients");

const MAX_NAME = 120;
const MAX_REASON = 160;

const NON_INGREDIENT_RE =
  /^(?:\*|tiempo\b|porcion(?:es)?\b|rinde\b|rendimiento\b|tipo\b|costo\b|total\b|paso\s*\d*\b|nota(?:s)?\b|procedimiento\b|instrucciones\b|preparacion\s*:)/;

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True for «Tiempo: 1 h», «Porciones: 6», «* nota», «Costo total»… */
export function isNonIngredientLine(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^[\d\s.,/:-]+$/.test(trimmed)) return true;
  return NON_INGREDIENT_RE.test(fold(trimmed));
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

const NUMBER_WORDS: Record<string, number> = {
  un: 1,
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
  medio: 0.5,
  media: 0.5,
  docena: 12,
};

/** Every number written in the text (digits, decimals, fractions, words). */
export function numbersWrittenIn(text: string): number[] {
  const values: number[] = [];
  const t = text.replace(/\s+/g, " ");

  // Mixed numbers and fractions first: «1 1/2», «1/2», «1½», «½».
  for (const m of t.matchAll(/(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])/g)) {
    values.push(Number(m[1]) + UNICODE_FRACTIONS[m[2]]);
  }
  for (const ch of Object.keys(UNICODE_FRACTIONS)) {
    if (t.includes(ch)) values.push(UNICODE_FRACTIONS[ch]);
  }
  for (const m of t.matchAll(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g)) {
    const d = Number(m[3]);
    if (d > 0) values.push(Number(m[1]) + Number(m[2]) / d);
  }
  for (const m of t.matchAll(/(\d+)\s*\/\s*(\d+)/g)) {
    const d = Number(m[2]);
    if (d > 0) values.push(Number(m[1]) / d);
  }
  // Plain and decimal numbers, with «.» or «,» as the decimal mark.
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const raw = m[0];
    values.push(Number(raw.replace(/,/g, ".")));
    values.push(Number(raw.replace(/,/g, "")));
    for (const part of raw.split(/[.,]/)) {
      if (part) values.push(Number(part));
    }
  }
  for (const m of t.matchAll(/(?:^|[^\d])[.,](\d+)/g)) {
    values.push(Number(`0.${m[1]}`));
  }
  for (const w of fold(t).split(/[^a-z]+/)) {
    if (w in NUMBER_WORDS) values.push(NUMBER_WORDS[w]);
  }
  return values.filter((v) => Number.isFinite(v));
}

function quantityIsWritten(q: number, written: number[]): boolean {
  return written.some(
    (v) => Math.abs(v - q) <= 0.005 || Math.abs(v - q) <= Math.abs(q) * 0.005
  );
}

function parseQuantity(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const s = value.trim().replace(",", ".");
    const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed && Number(mixed[3]) > 0) {
      return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    }
    const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac && Number(frac[2]) > 0) return Number(frac[1]) / Number(frac[2]);
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      return n > 0 ? n : null;
    }
  }
  return null;
}

function confidenceOf(v: unknown): "high" | "medium" | "low" {
  return v === "high" || v === "medium" || v === "low" ? v : "low";
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

export function validateUploadResponse(
  raw: unknown,
  /** The chunk's text, when it is a text chunk (enables the anti-invention guard). */
  chunkText: string | null,
  /** The chunk's label (sheet/tab name), when known. */
  tabLabel: string | null = null,
  /** Language of the reasons we write ourselves (default Spanish). */
  lang: PreferredLanguage = "es"
): ValidatedChunk {
  const out: ValidatedChunk = { recipes: [], ignored: [] };
  if (!raw || typeof raw !== "object") return out;
  const root = raw as Record<string, unknown>;

  const rawRecipes: unknown[] = Array.isArray(root.recipes)
    ? root.recipes
    : typeof root.dish_name === "string"
      ? [root]
      : [];
  if (Array.isArray(root.ignored)) {
    for (const item of root.ignored) {
      if (!item || typeof item !== "object") continue;
      const i = item as Record<string, unknown>;
      const name = cleanText(i.name, MAX_NAME);
      const reason = cleanText(i.reason, MAX_REASON);
      if (name || reason) {
        out.ignored.push({
          name: name ?? "",
          reason: reason ?? uploadMsg(lang, "notARecipe"),
        });
      }
    }
  }

  const written = chunkText ? numbersWrittenIn(chunkText) : null;

  for (const item of rawRecipes) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = cleanText(r.dish_name, MAX_NAME);
    if (!name) {
      out.ignored.push({
        name: "",
        reason: uploadMsg(lang, "noRecipeName"),
      });
      continue;
    }

    const lines: ExtractedIngredientLine[] = [];
    const sourceLines = Array.isArray(r.ingredients) ? r.ingredients : [];
    for (const ln of sourceLines) {
      if (!ln || typeof ln !== "object") continue;
      const l = ln as Record<string, unknown>;
      const lineName = cleanText(l.name, MAX_NAME);
      if (!lineName || isNonIngredientLine(lineName)) continue;
      let quantity = parseQuantity(l.estimated_quantity);
      let confidence = confidenceOf(l.confidence);
      if (
        quantity !== null &&
        written &&
        !quantityIsWritten(quantity, written)
      ) {
        quantity = null;
        confidence = "low";
      }
      if (quantity === null) confidence = "low";
      let unit = cleanText(l.unit, 40);
      // A bare count («2 zanahorias», «1/2 repollo») is in «unidad».
      if (quantity !== null && unit === null) unit = "unidad";
      lines.push({
        name: lineName,
        estimated_quantity: quantity,
        unit,
        confidence,
      });
    }

    if (lines.length === 0) {
      out.ignored.push({ name, reason: uploadMsg(lang, "noIngredients") });
      continue;
    }

    // Portions are an integer that is written in the text; else null.
    let portions =
      typeof r.portions === "number" &&
      Number.isInteger(r.portions) &&
      r.portions > 0
        ? r.portions
        : null;
    if (portions !== null && written && !quantityIsWritten(portions, written)) {
      portions = null;
    }

    // The model's kind is advisory: what is written decides (classify.ts).
    const yieldText = cleanText(r.yield_text, 120);
    const classified = classifyRecipeKind({
      yieldText,
      tabLabel,
      modelKind: typeof r.kind === "string" ? r.kind : null,
      modelPortions: portions,
    });

    const candidate = {
      dish_name: name,
      portions: classified.portions,
      ingredients: lines,
      overall_confidence: confidenceOf(r.overall_confidence),
    };
    if (!validateExtractedRecipe(candidate)) {
      out.ignored.push({ name, reason: uploadMsg(lang, "unreadableRecipe") });
      continue;
    }

    out.recipes.push({
      ...candidate,
      kind: classified.kind,
      yield_text: yieldText,
      tab_label: tabLabel,
    });
  }
  return out;
}
