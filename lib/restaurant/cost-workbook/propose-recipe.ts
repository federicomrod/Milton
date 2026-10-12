// AI / heuristic recipe proposal for one POS product.
// The model only picks a parsed COSTO RESTAURANTE block. Invalid JSON
// or a guess that does not match a real block is "sin sugerencia".

import { z } from "zod";
import { openai } from "@/lib/openai-client";
import { nameKey, parseCostImportNumber } from "@/lib/restaurant/cost-import";
import type { GroupedRecipe, RecipeLineCandidate } from "./types";

export const SIN_SUGERENCIA = "sin sugerencia" as const;
export type SinSugerencia = typeof SIN_SUGERENCIA;

export const YIELD_SOURCES = ["excel", "inferred", "assumed"] as const;
export type RecipeProposalYieldSource = (typeof YIELD_SOURCES)[number];

export const recipeProposalLineSchema = z.object({
  source_row: z.number().int().nonnegative(),
  raw_name: z.string().min(1),
  ingredient_match: z.string().nullable(),
  sub_recipe_match: z.string().nullable(),
  qty: z.number().finite(),
  unit: z.string().min(1),
  unit_cost: z.number().finite().nullable(),
  flags: z.array(z.string()),
});

export const recipeProposalSchema = z.object({
  tab: z.string().min(1),
  block_name: z.string().min(1),
  confidence: z.number().finite().min(0).max(1),
  evidence: z.string().min(1),
  lines: z.array(recipeProposalLineSchema).min(1),
  yield: z.object({
    value: z.number().finite().positive(),
    unit: z.string().min(1),
    source: z.enum(YIELD_SOURCES),
  }),
  excel_total: z.number().finite().nullable(),
});

export type RecipeProposal = z.infer<typeof recipeProposalSchema>;
export type RecipeProposalLine = z.infer<typeof recipeProposalLineSchema>;
export type ProposeRecipeResult = RecipeProposal | SinSugerencia;

export interface RecipeSuggestionProduct {
  odoo_product_id: number;
  odoo_name: string;
  net_sales?: number;
  share_of_net_sales?: number;
}

export interface ProposeRecipeInput {
  product: RecipeSuggestionProduct;
  candidateBlocks: readonly GroupedRecipe[];
}

export function isSinSugerencia(
  value: ProposeRecipeResult
): value is SinSugerencia {
  return value === SIN_SUGERENCIA;
}

export function parseRecipeProposal(raw: unknown): ProposeRecipeResult {
  const parsed = recipeProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : SIN_SUGERENCIA;
}

export function lineUnitCostFromRaw(
  raw: Record<string, unknown> | undefined
): number | null {
  if (!raw) return null;
  const n =
    parseCostImportNumber(raw["Costo Unitario"]) ??
    parseCostImportNumber(raw.Costo) ??
    parseCostImportNumber(raw.unit_cost);
  return n != null && Number.isFinite(n) && n > 0 ? n : null;
}

export function yieldSourceForBlock(
  block: GroupedRecipe
): RecipeProposalYieldSource {
  if (block.yield_assumed) return "assumed";
  if (block.cost_total_inferred) return "inferred";
  if (block.output_quantity != null && block.output_unit) return "excel";
  return "inferred";
}

export function proposalFromBlock(
  block: GroupedRecipe,
  input: {
    confidence: number;
    evidence: string;
  }
): RecipeProposal {
  return {
    tab: block.tabName,
    block_name: block.name,
    confidence: input.confidence,
    evidence: input.evidence,
    lines: [
      ...block.lines.map((line) => proposalLineFromCandidate(line)),
      ...(block.pending_lines ?? []).map((line) =>
        proposalLineFromCandidate(line)
      ),
    ],
    yield: {
      value:
        block.output_quantity != null && block.output_quantity > 0
          ? block.output_quantity
          : 1,
      unit: block.output_unit?.trim() || "unit",
      source: yieldSourceForBlock(block),
    },
    excel_total:
      block.cost_total != null && Number.isFinite(block.cost_total)
        ? block.cost_total
        : null,
  };
}

export function proposalLineFromCandidate(
  line: RecipeLineCandidate
): RecipeProposalLine {
  return {
    source_row: line.rowIndex,
    raw_name: line.ingredient_name,
    ingredient_match: null,
    sub_recipe_match: null,
    qty: line.quantity,
    unit: line.unit,
    unit_cost: lineUnitCostFromRaw(line.raw),
    flags: [],
  };
}

export function findExactBlockMatch(
  productName: string,
  candidateBlocks: readonly GroupedRecipe[]
): GroupedRecipe | null {
  const key = nameKey(productName);
  if (!key) return null;
  const dishes = candidateBlocks.filter(
    (block) => block.kind === "recipe" && nameKey(block.name) === key
  );
  if (dishes.length === 1) return dishes[0] ?? null;
  return null;
}

export function findBlockForProposal(
  proposal: RecipeProposal,
  candidateBlocks: readonly GroupedRecipe[]
): GroupedRecipe | null {
  const tabKey = nameKey(proposal.tab);
  const nameKeyValue = nameKey(proposal.block_name);
  const matches = candidateBlocks.filter(
    (block) =>
      block.kind === "recipe" &&
      nameKey(block.name) === nameKeyValue &&
      nameKey(block.tabName) === tabKey
  );
  if (matches.length === 1) return matches[0] ?? null;
  const byName = candidateBlocks.filter(
    (block) => block.kind === "recipe" && nameKey(block.name) === nameKeyValue
  );
  return byName.length === 1 ? (byName[0] ?? null) : null;
}

function qtyClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6;
}

export function proposalMatchesBlock(
  proposal: RecipeProposal,
  block: GroupedRecipe
): boolean {
  if (nameKey(proposal.block_name) !== nameKey(block.name)) return false;
  if (proposal.lines.length === 0) return false;
  const allLines = [...block.lines, ...(block.pending_lines ?? [])];
  for (const line of proposal.lines) {
    const candidate = allLines.find((row) => row.rowIndex === line.source_row);
    if (!candidate) return false;
    if (nameKey(candidate.ingredient_name) !== nameKey(line.raw_name)) {
      return false;
    }
    if (!qtyClose(candidate.quantity, line.qty)) return false;
    if (nameKey(candidate.unit) !== nameKey(line.unit)) return false;
  }
  return true;
}

/**
 * Heuristic fallback: only an exact unique dish-block name match.
 * Never fuzzy-matches. Ambiguous or missing → sin sugerencia.
 */
export function proposeRecipeHeuristic(
  input: ProposeRecipeInput
): ProposeRecipeResult {
  const block = findExactBlockMatch(
    input.product.odoo_name,
    input.candidateBlocks
  );
  if (!block || block.lines.length === 0) return SIN_SUGERENCIA;
  return proposalFromBlock(block, {
    confidence: 1,
    evidence: `nombre exacto: ${block.name} (${block.tabName})`,
  });
}

function compactBlocks(blocks: readonly GroupedRecipe[]) {
  return blocks
    .filter((block) => block.kind === "recipe")
    .map((block) => ({
      tab: block.tabName,
      block_name: block.name,
      excel_total: block.cost_total ?? null,
      yield: {
        value: block.output_quantity,
        unit: block.output_unit,
        assumed: Boolean(block.yield_assumed),
      },
      lines: [...block.lines, ...(block.pending_lines ?? [])].map((line) => ({
        source_row: line.rowIndex,
        raw_name: line.ingredient_name,
        qty: line.quantity,
        unit: line.unit,
        unit_cost: lineUnitCostFromRaw(line.raw),
      })),
    }));
}

function parseAiJson(raw: string): unknown {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  if (cleaned === SIN_SUGERENCIA) return SIN_SUGERENCIA;
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Bind an AI-picked block back to the parsed lines. AI may only choose
 * tab + block_name (+ evidence). Invented lines fail the schema bind.
 */
export function bindProposalToParsedBlock(
  raw: unknown,
  candidateBlocks: readonly GroupedRecipe[]
): ProposeRecipeResult {
  const proposal = parseRecipeProposal(raw);
  if (isSinSugerencia(proposal)) return SIN_SUGERENCIA;
  const block = findBlockForProposal(proposal, candidateBlocks);
  if (!block) return SIN_SUGERENCIA;
  if (!proposalMatchesBlock(proposal, block)) return SIN_SUGERENCIA;
  return proposalFromBlock(block, {
    confidence: proposal.confidence,
    evidence: proposal.evidence,
  });
}

export async function proposeRecipeWithAi(
  input: ProposeRecipeInput
): Promise<ProposeRecipeResult> {
  if (!process.env.OPENAI_API_KEY) {
    return proposeRecipeHeuristic(input);
  }
  const dishes = compactBlocks(input.candidateBlocks);
  if (dishes.length === 0) return SIN_SUGERENCIA;

  const systemPrompt =
    "Eres un asistente que solo elige un bloque de receta ya parseado " +
    "de un Excel COSTO RESTAURANTE para un producto del POS. " +
    "Nunca inventes ingredientes, cantidades, unidades ni costos. " +
    "Si no hay un bloque único y claro, responde exactamente: sin sugerencia. " +
    "Si hay un bloque, responde JSON válido con: tab, block_name, confidence " +
    "(0-1), evidence, lines[{source_row, raw_name, ingredient_match, " +
    "sub_recipe_match, qty, unit, unit_cost, flags}], yield{value, unit, " +
    "source: excel|inferred|assumed}, excel_total. " +
    "Copia source_row, raw_name, qty, unit y unit_cost del bloque. " +
    "ingredient_match y sub_recipe_match pueden ser null. flags puede ser [].";

  const userPrompt = `Producto POS: ${JSON.stringify({
    odoo_product_id: input.product.odoo_product_id,
    odoo_name: input.product.odoo_name,
  })}

Bloques candidatos:
${JSON.stringify(dishes)}

Responde JSON o exactamente: sin sugerencia`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const content = completion?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content || content === SIN_SUGERENCIA) return SIN_SUGERENCIA;
  const parsed = parseAiJson(content);
  if (parsed === SIN_SUGERENCIA || parsed == null) return SIN_SUGERENCIA;
  return bindProposalToParsedBlock(parsed, input.candidateBlocks);
}
