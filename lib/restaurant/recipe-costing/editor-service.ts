// Validar editor operations. All I/O goes through EditorStore so the rules
// (what may be edited, what gets created, what is remembered) are tested
// without a database.
//
// Rules:
// - Only an in-review version can be edited; an approved one is read-only.
// - A line is resolved by picking an existing ingredient or preparation.
//   Nothing is ever created from a typed name: creating an ingredient is a
//   separate, explicit action with its own name, unit and optional price.
// - A confirmed pick for a differently-written name is remembered for the
//   company, so the same question is not asked again.
// - After every edit the cached evidence is rebuilt from the inputs, so the
//   screen, the checklist and the approved recipe agree.

import { approvalRecord, type ApprovalRecord } from "./approval-audit";
import type { CostingData } from "@/lib/restaurant/costing";
import {
  normalizeMatchName,
  bestNameMatch,
} from "@/lib/restaurant/cost-workbook/names";
import { isUsableLineUnit, normalizeUnit } from "@/lib/restaurant/units";
import { matchExistingIngredient } from "./ingredient-match";
import {
  buildPickerOptions,
  hydrateLines,
  latestPrice,
  needsTypedQuantity,
  rebuildEvidence,
  type CatalogQuestion,
  type EditorLine,
  type EvidenceLineIn,
  type PickerOption,
  type PossibleMatch,
  type PriceMeta,
  type VersionInput,
} from "./editor";

export interface LinkRef {
  id: string;
  menu_item_id: string | null;
  evidence: Record<string, unknown>;
}

/** Where the cached evidence of a recipe lives. */
export interface EvidenceHolder {
  kind: "dish" | "preparation";
  /** pos_product_links.id for a dish; the review item id for a preparation. */
  id: string | null;
  evidence: Record<string, unknown>;
}

export interface VersionRef {
  id: string;
  status: string;
  /** Dish versions live in recipe_versions, preparations in
   *  component_recipe_versions. */
  kind: "dish" | "preparation";
  menu_item_id?: string;
  component_id?: string;
  component_recipe_id?: string;
  output_quantity?: number;
  output_unit?: string;
}

export interface PreparationRef {
  component_id: string;
  name: string;
  holder: EvidenceHolder;
  version: VersionRef | null;
}

export interface CostingLoad {
  data: CostingData;
  /** Human label for where an entry's price came from. */
  sourceOf(entryId: string | undefined): string;
}

export interface NewCostEntry {
  /** Keep the entry in `unit` (a unit correction) instead of the ingredient's own unit. */
  keepUnit?: boolean;
  ingredientId: string;
  unit: string;
  unitCost: number;
  currency: string;
  date: string;
  dateSource: "manual";
  note: string;
}

export interface EditorStore {
  loadCosting(companyId: string): Promise<CostingLoad>;
  /** The ingredient this one was merged into (latest merge not undone), if any. */
  mergedInto(
    companyId: string,
    ingredientId: string
  ): Promise<{ name: string } | null>;
  loadLink(
    companyId: string,
    odooProductId: number,
    locationId: string | null
  ): Promise<LinkRef | null>;
  saveEvidence(
    companyId: string,
    holder: EvidenceHolder,
    evidence: Record<string, unknown>
  ): Promise<void>;
  latestVersion(
    companyId: string,
    menuItemId: string
  ): Promise<VersionRef | null>;
  loadPreparation(
    companyId: string,
    componentId: string
  ): Promise<PreparationRef | null>;
  listInputs(companyId: string, version: VersionRef): Promise<VersionInput[]>;
  /** An EMPTY in-review version after `from` (the next number, no effective date).
   *  Its lines are copied by the caller; `from` is never touched. */
  createDraftVersion(companyId: string, from: VersionRef): Promise<VersionRef>;
  insertInput(
    companyId: string,
    version: VersionRef,
    row: Omit<VersionInput, "id">
  ): Promise<VersionInput>;
  updateInput(
    companyId: string,
    version: VersionRef,
    inputId: string,
    patch: Partial<Omit<VersionInput, "id">>
  ): Promise<void>;
  deleteInput(
    companyId: string,
    version: VersionRef,
    inputId: string
  ): Promise<void>;
  /** Preparations only: the yield of an in-review version. */
  setPreparationYield(
    companyId: string,
    version: VersionRef,
    input: { quantity: number; unit: string }
  ): Promise<void>;
  /** Preparations only: mark the in-review version approved, recording
   *  who approved it, when and how (migration 041). */
  approvePreparationVersion(
    companyId: string,
    version: VersionRef,
    approval: ApprovalRecord
  ): Promise<void>;
  /** Close the open review item once the preparation is approved. */
  resolveHolder(companyId: string, holder: EvidenceHolder): Promise<void>;
  /** Dishes whose recipe uses this preparation, to refresh their costs. */
  dishesUsingPreparation(
    companyId: string,
    componentId: string
  ): Promise<Array<{ odooProductId: number; locationId: string | null }>>;
  createIngredient(
    companyId: string,
    input: { name: string; defaultUnit: string; currency: string }
  ): Promise<{ id: string; name: string; default_unit: string | null }>;
  /** A preparation a person creates by hand: its own draft (in-review)
   *  version with no lines yet, yield as the person typed it. */
  createPreparation(
    companyId: string,
    input: { name: string; outputQuantity: number; outputUnit: string }
  ): Promise<{ id: string; name: string }>;
  /** A refused price (its unit cannot be read in the ingredient's unit) is a
   *  Spanish message to show, not an exception. */
  addCostEntry(
    companyId: string,
    entry: NewCostEntry
  ): Promise<
    { ok: true } | { ok: false; error: string; conversion?: ConversionHint }
  >;
  /** Unclear price-list rows still open. */
  catalogQuestions(companyId: string): Promise<CatalogQuestion[]>;
  /** The person picked how an unclear price-list row reads. Adds the
   *  ingredient (in that unit) if it is not in the list yet. */
  answerCatalogQuestion(
    companyId: string,
    itemId: string,
    unit: string
  ): Promise<
    { ok: true; ingredientId: string } | { ok: false; reason: string }
  >;
  /** "Ninguna / Pendiente": close the question with no price. */
  skipCatalogQuestion(
    companyId: string,
    itemId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  loadAliases(companyId: string): Promise<Map<string, string>>;
  rememberAlias(input: {
    companyId: string;
    aliasName: string;
    ingredientId: string;
    userId: string | null;
  }): Promise<void>;
  currency(companyId: string): Promise<string>;
}

export interface PreparationYield {
  value: number;
  unit: string;
  confirmed: boolean;
  source: string | null;
}

export interface PreparationChecklist {
  has_lines: boolean;
  lines_resolved: boolean;
  costs_known: boolean;
  yield_confirmed: boolean;
  ready: boolean;
  blockers: string[];
}

export interface EditorState {
  editable: boolean;
  /** Why it cannot be edited, when it cannot. */
  locked_reason: string | null;
  version_id: string | null;
  lines: EditorLine[];
  options: PickerOption[];
  /** True when `options` was left out because the client caches it. */
  options_omitted?: boolean;
  pending: number;
  /** Sum of line costs, when every line is costed. */
  total_cost: number | null;
  /** Preparations only. */
  preparation?: {
    component_id: string;
    name: string;
    status: string;
    yield: PreparationYield | null;
    cost_per_output_unit: number | null;
    checklist: PreparationChecklist;
  };
}

/** What «Definir conversión» needs: this ingredient, in this unit, to its price unit. */
export interface ConversionHint {
  ingredient_id: string;
  ingredient_name: string;
  from_unit: string;
  to_unit: string;
}

export type EditorResult =
  | { ok: true; state: EditorState }
  | { ok: false; error: string; status?: number; conversion?: ConversionHint };

export interface Ctx {
  store: EditorStore;
  companyId: string;
  /** A dish (by POS product) unless componentId is set. */
  odooProductId: number;
  locationId: string | null;
  /** Edit a preparation instead of a dish. */
  componentId?: string;
  userId: string | null;
  /** The client already has the picker list (R1-09c): do not send it. */
  omitOptions?: boolean;
  /**
   * R1-12: a permission check the caller runs in parallel with the reads.
   * applyEdit awaits it before its first write; a non-null answer is
   * returned as is and nothing is written.
   */
  guard?: Promise<{ ok: false; error: string; status?: number } | null>;
}

function parseUnitQuestion(
  raw: unknown
): { written: string; suggested: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return typeof row.written === "string" && typeof row.suggested === "string"
    ? { written: row.written, suggested: row.suggested }
    : null;
}

function resolvedName(
  raw: unknown,
  kind: "ingredient" | "component"
): string | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return row.kind === kind && typeof row.name === "string" ? row.name : null;
}

export function yieldOf(
  evidence: Record<string, unknown>
): PreparationYield | null {
  const raw = evidence.yield;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const value = typeof row.value === "number" ? row.value : Number(row.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    value,
    unit: typeof row.unit === "string" ? row.unit : "unit",
    confirmed: row.confirmed !== false && row.source !== "assumed",
    source: typeof row.source === "string" ? row.source : null,
  };
}

export function evidenceLinesOf(
  evidence: Record<string, unknown>
): EvidenceLineIn[] {
  const raw = Array.isArray(evidence.lines) ? evidence.lines : [];
  const out: EvidenceLineIn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.raw_name !== "string" || !row.raw_name.trim()) continue;
    const flags = Array.isArray(row.flags)
      ? row.flags.filter((f): f is string => typeof f === "string")
      : [];
    out.push({
      source_row: typeof row.source_row === "number" ? row.source_row : null,
      raw_name: row.raw_name,
      ingredient_match:
        typeof row.ingredient_match === "string"
          ? row.ingredient_match
          : resolvedName(row.resolved, "ingredient"),
      sub_recipe_match:
        typeof row.sub_recipe_match === "string"
          ? row.sub_recipe_match
          : resolvedName(row.resolved, "component"),
      qty: typeof row.qty === "number" ? row.qty : Number(row.qty) || 0,
      unit: typeof row.unit === "string" ? row.unit : "",
      pending:
        row.pending === true || flags.some((f) => f.startsWith("pendiente_")),
      reasons: Array.isArray(row.reasons)
        ? row.reasons.filter((r): r is string => typeof r === "string")
        : [],
      flags,
      input_id: typeof row.input_id === "string" ? row.input_id : null,
      unit_question: parseUnitQuestion(row.unit_question),
      excel_unit_cost:
        typeof row.excel_unit_cost === "number" ? row.excel_unit_cost : null,
    });
  }
  return out;
}

async function build(
  ctx: Ctx,
  loaded: Loaded,
  evidenceLines: EvidenceLineIn[]
): Promise<{ state: EditorState; lines: EditorLine[] }> {
  const { version } = loaded;
  // R1-12: the catalog questions are only used when a line is unpriced or
  // unresolved, but asking for them costs no extra wave: start them with
  // the other reads and wait for them only if needed.
  const questionsRead = ctx.store.catalogQuestions(ctx.companyId);
  questionsRead.catch(() => undefined);
  // Independent reads: one round trip instead of three.
  const [costing, aliases, inputs] = await Promise.all([
    ctx.store.loadCosting(ctx.companyId),
    ctx.store.loadAliases(ctx.companyId),
    version
      ? ctx.store.listInputs(ctx.companyId, version)
      : Promise.resolve([]),
  ]);
  const { data } = costing;

  // Names of every ingredient (old lines may still read an archived one);
  // matching only offers the active ones.
  const allIngredientRefs = [...data.ingredientsById.values()].map((row) => ({
    id: row.id,
    name: row.name,
    default_unit: row.default_unit,
    archived: row.archived === true,
  }));
  const ingredientRefs = allIngredientRefs.filter((r) => !r.archived);
  // A preparation never offers itself as one of its own lines.
  const componentRefs = [...data.componentsById.values()]
    .filter((row) => row.id !== loaded.preparation?.component_id)
    .map((row) => ({ id: row.id, name: row.name }));
  const priceCache = new Map<string, PriceMeta | null>();
  const priceOf = (id: string): PriceMeta | null => {
    if (!priceCache.has(id)) {
      priceCache.set(id, latestPrice(data, id, costing.sourceOf));
    }
    return priceCache.get(id) ?? null;
  };

  const suggest = (rawName: string): PossibleMatch | null => {
    const hit = matchExistingIngredient(rawName, ingredientRefs, aliases);
    if (hit.kind === "exact" || hit.kind === "possible") {
      return {
        kind: "ingredient",
        id: hit.ingredient.id,
        name: hit.ingredient.name,
      };
    }
    const component = bestNameMatch(rawName, componentRefs, (c) => c.name);
    if (component && component.score >= 0.85) {
      return {
        kind: "component",
        id: component.item.id,
        name: component.item.name,
      };
    }
    return null;
  };

  const lines = hydrateLines({
    data,
    evidenceLines,
    inputs,
    names: {
      ingredients: new Map(allIngredientRefs.map((r) => [r.id, r.name])),
      components: new Map(componentRefs.map((r) => [r.id, r.name])),
      priceOf,
      suggest,
    },
  });

  // A line whose ingredient sits on an unclear price-list row: ask how the
  // row reads, right on the line (by ingredient, or by the exact name for
  // a line that is not in the list yet).
  if (
    lines.some(
      (line) =>
        (line.ingredient_id && !line.price) || line.kind === "unresolved"
    )
  ) {
    const questions = (await questionsRead).filter((q) => q.options.length > 0);
    const byIngredient = new Map(
      questions.filter((q) => q.ingredient_id).map((q) => [q.ingredient_id!, q])
    );
    const byName = new Map(
      questions.map((q) => [normalizeMatchName(q.name), q])
    );
    for (const line of lines) {
      if (line.kind === "unresolved") {
        const q = byName.get(normalizeMatchName(line.raw_name));
        if (q) line.catalog_question = q;
      } else if (line.ingredient_id && !line.price) {
        const q =
          byIngredient.get(line.ingredient_id) ??
          byName.get(normalizeMatchName(line.name ?? ""));
        if (q) line.catalog_question = q;
      }
    }
  }

  const editable = version?.status === "in_review";
  const isPrep = Boolean(loaded.preparation);
  const anyPending = lines.some((line) => line.pending);
  const totalCost =
    lines.length > 0 && !anyPending
      ? lines.reduce((sum, line) => sum + (line.amount ?? 0), 0)
      : null;
  const options = ctx.omitOptions
    ? []
    : buildPickerOptions({ data, priceOf }).filter(
        (o) =>
          !(o.kind === "component" && o.id === loaded.preparation?.component_id)
      );

  const state: EditorState = {
    editable,
    locked_reason: !version
      ? isPrep
        ? "Esta preparación todavía no tiene receta."
        : "Este plato todavía no tiene una receta."
      : editable
        ? null
        : isPrep
          ? "Esta preparación ya está aprobada. Para cambiarla hace falta una versión nueva."
          : "Esta receta ya está aprobada. Para cambiarla hace falta una versión nueva.",
    version_id: version?.id ?? null,
    lines,
    options,
    options_omitted: ctx.omitOptions === true,
    pending: lines.filter((line) => line.pending).length,
    total_cost: totalCost,
  };

  if (loaded.preparation) {
    const fromEvidence = yieldOf(loaded.holder.evidence);
    const prepYield: PreparationYield | null =
      fromEvidence ??
      (version?.output_quantity
        ? {
            value: version.output_quantity,
            unit: version.output_unit ?? "unit",
            confirmed: true,
            source: null,
          }
        : null);
    const checklist = preparationChecklist(lines, prepYield);
    state.preparation = {
      component_id: loaded.preparation.component_id,
      name: loaded.preparation.name,
      status: version?.status ?? "sin_receta",
      yield: prepYield,
      cost_per_output_unit:
        totalCost !== null && prepYield ? totalCost / prepYield.value : null,
      checklist,
    };
  }
  return { lines, state };
}

export function preparationChecklist(
  lines: readonly EditorLine[],
  prepYield: PreparationYield | null
): PreparationChecklist {
  const hasLines = lines.length > 0;
  const resolved = hasLines && !lines.some((l) => l.kind === "unresolved");
  const costs = hasLines && lines.every((l) => l.amount !== null && !l.pending);
  const yieldOk = Boolean(prepYield?.confirmed);
  const blockers: string[] = [];
  if (!hasLines) blockers.push("La preparación no tiene ingredientes.");
  if (hasLines && !resolved)
    blockers.push("Hay líneas que todavía no están en tu lista.");
  if (hasLines && resolved && !costs)
    blockers.push("A alguna línea le falta precio o una unidad que cuadre.");
  if (!yieldOk) blockers.push("Confirma cuánto rinde.");
  return {
    has_lines: hasLines,
    lines_resolved: resolved,
    costs_known: costs,
    yield_confirmed: yieldOk,
    ready: hasLines && resolved && costs && yieldOk,
    blockers,
  };
}

interface Loaded {
  holder: EvidenceHolder;
  version: VersionRef | null;
  preparation?: { component_id: string; name: string };
}

async function load(
  ctx: Ctx
): Promise<
  { ok: false; error: string; status: number } | ({ ok: true } & Loaded)
> {
  if (ctx.componentId) {
    const prep = await ctx.store.loadPreparation(
      ctx.companyId,
      ctx.componentId
    );
    if (!prep) {
      return { ok: false, error: "No encontré esa preparación.", status: 404 };
    }
    return {
      ok: true,
      holder: prep.holder,
      version: prep.version,
      preparation: { component_id: prep.component_id, name: prep.name },
    };
  }
  const link = await ctx.store.loadLink(
    ctx.companyId,
    ctx.odooProductId,
    ctx.locationId
  );
  if (!link) {
    return {
      ok: false,
      error: "No hay un vínculo para este producto.",
      status: 404,
    };
  }
  const version = link.menu_item_id
    ? await ctx.store.latestVersion(ctx.companyId, link.menu_item_id)
    : null;
  return {
    ok: true,
    holder: { kind: "dish", id: link.id, evidence: link.evidence },
    version,
  };
}

export async function loadEditor(ctx: Ctx): Promise<EditorResult> {
  // R1-12: the catalog and aliases do not depend on the dish: read them
  // while the link and version are being found (they used to wait).
  const readCtx: Ctx = { ...ctx, store: withCachedCatalog(ctx.store) };
  warmCatalog(readCtx);
  const loaded = await load(readCtx);
  if (!loaded.ok) return loaded;
  const built = await build(
    readCtx,
    loaded,
    evidenceLinesOf(loaded.holder.evidence)
  );
  return { ok: true, state: built.state };
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export type EditorAction =
  | {
      action: "add";
      kind: "ingredient" | "component";
      id: string;
      quantity: number;
      unit: string;
    }
  | { action: "update"; input_id: string; quantity?: number; unit?: string }
  | { action: "answer_unit"; input_id: string; unit: string }
  | { action: "set_yield"; quantity: number; unit: string }
  | {
      action: "change_item";
      input_id: string;
      kind: "ingredient" | "component";
      id: string;
    }
  | {
      action: "resolve";
      line_key: string;
      kind: "ingredient" | "component";
      id: string;
      /** Typed by the person; required for a line read from the menu. */
      quantity?: number;
      line_unit?: string;
    }
  | { action: "remove"; line_key: string }
  /** «Crear versión nueva»: a draft copy of the approved recipe (the approved one is not changed). */
  | { action: "new_version" }
  | {
      /** This line's own price per its unit (null = back to the list). */
      action: "set_line_cost";
      input_id: string;
      unit_cost: number | null;
    }
  | {
      action: "create_ingredient";
      name: string;
      unit: string;
      unit_cost?: number;
      /** Add it to the recipe (and resolve this line, if given). */
      line_key?: string;
      quantity?: number;
      line_unit?: string;
    }
  | {
      action: "set_price";
      ingredient_id: string;
      unit: string;
      unit_cost: number;
      /** «Usar como precio del ingrediente»: the old price copy of a line. */
      adopt_legacy?: boolean;
      /** «Corregir unidad del precio»: the same price in another unit, as a NEW dated entry. */
      correct_unit?: boolean;
    }
  | {
      action: "answer_catalog_unit";
      item_id: string;
      unit: string;
      /** An unresolved line that names this row: use the ingredient there. */
      line_key?: string;
    }
  | {
      action: "create_preparation";
      name: string;
      /** How much one batch yields, as the person states it. */
      yield_quantity: number;
      yield_unit: string;
      /** Use it on this line (and resolve it), or add it as a new line. */
      line_key?: string;
      quantity?: number;
      line_unit?: string;
    };

const MAX_NAME = 120;

/**
 * A line's own cost (from the client's file) is per its unit and item.
 * When a person changes either, that cost no longer applies: the line
 * goes back to the catalog price. Only touches the columns when the line
 * had one (so a database without migration 043 is never written to).
 */
function clearedOwnCost(
  current: VersionInput
): Partial<Pick<VersionInput, "unit_cost" | "cost_source">> {
  return current.unit_cost != null
    ? { unit_cost: null, cost_source: null }
    : {};
}

function asYieldRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** "Ninguna / Pendiente" as an answer to a price-list question. */
export const NO_PRICE_ANSWER = "none";

const TYPE_QUANTITY_FIRST =
  "Escribe cuánto lleva el plato (cantidad y unidad) antes de elegir.";

/**
 * Quantity and unit for an unresolved line that is being resolved. What
 * the person typed wins; else what the file said. A line read from the
 * menu has no quantity, so it needs one typed: null means "ask first",
 * never an assumed 1.
 */
function amountForLine(
  line: EditorLine,
  typed: { quantity?: number; unit?: string },
  fallbackUnit: string
): { quantity: number; unit: string } | null {
  if (needsTypedQuantity(line)) {
    const quantity = cleanQuantity(typed.quantity);
    const unit = cleanUnit(typed.unit);
    return quantity && unit ? { quantity, unit } : null;
  }
  return {
    quantity: cleanQuantity(typed.quantity) ?? cleanQuantity(line.qty) ?? 1,
    unit: cleanUnit(typed.unit) ?? cleanUnit(line.unit) ?? fallbackUnit,
  };
}

function cleanQuantity(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * A price a person typed: zero is allowed (water, ice) because they typed
 * it; a missing value is never turned into zero (null = not given).
 */
export function cleanPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Note on the price entry, so a $0 is visibly on purpose. */
const ZERO_PRICE_NOTE = "Precio $0 confirmado a propósito";

function cleanUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 24) return null;
  return isUsableLineUnit(text) ? text : null;
}

/** Edits that touch file (evidence) lines by position: pin them first. */
const PIN_ACTIONS = new Set<EditorAction["action"]>([
  "resolve",
  "remove",
  // These update file lines by input id: the ids must be pinned.
  "change_item",
  "answer_unit",
  "create_ingredient",
  "create_preparation",
  "answer_catalog_unit",
]);

/** Edits that change the catalog (prices, items, yields): re-read it. */
const CATALOG_ACTIONS = new Set<EditorAction["action"]>([
  "set_price",
  "create_ingredient",
  "create_preparation",
  "answer_catalog_unit",
  "set_yield",
]);

export async function applyEdit(
  ctx: Ctx,
  action: EditorAction
): Promise<EditorResult> {
  // The catalog is read once per edit (below); start it with the link and
  // version reads instead of after them.
  const readCtx: Ctx = { ...ctx, store: withCachedCatalog(ctx.store) };
  warmCatalog(readCtx);
  const loaded = await load(ctx);
  if (!loaded.ok) return loaded;
  const denied = await ctx.guard;
  if (denied) return denied;
  const { holder, version } = loaded;
  if (action.action === "set_yield" && !loaded.preparation) {
    return {
      ok: false,
      error: "El rendimiento se confirma en la preparación.",
      status: 400,
    };
  }

  // Prices are not part of a version: setting one is allowed on any recipe.
  if (action.action === "new_version") {
    if (!version) {
      return {
        ok: false,
        error: "Este plato todavía no tiene una receta.",
        status: 400,
      };
    }
    if (version.status === "in_review") {
      return {
        ok: false,
        error: "Ya hay un borrador abierto de esta receta.",
        status: 409,
      };
    }
    // A copy: the approved version and its lines are never changed.
    const draft = await ctx.store.createDraftVersion(ctx.companyId, version);
    for (const row of await ctx.store.listInputs(ctx.companyId, version)) {
      await ctx.store.insertInput(ctx.companyId, draft, {
        input_type: row.input_type,
        ingredient_id: row.ingredient_id,
        component_id: row.component_id,
        quantity: row.quantity,
        unit: row.unit,
        unit_cost: row.unit_cost ?? null,
        cost_source: row.cost_source ?? null,
      });
    }
    return loadEditor({ ...ctx, omitOptions: false });
  }
  if (
    action.action !== "set_price" &&
    action.action !== "answer_catalog_unit"
  ) {
    if (!version) {
      return {
        ok: false,
        error: "Este plato todavía no tiene una receta.",
        status: 400,
      };
    }
    if (version.status !== "in_review") {
      return {
        ok: false,
        error:
          "Esta receta ya está aprobada. Para cambiarla hace falta una versión nueva.",
        status: 409,
      };
    }
  }

  let evidenceLines = evidenceLinesOf(holder.evidence);
  let evidenceYield: Record<string, unknown> | null = null;
  // The company's catalog is read once per edit (it was read 3–4 times:
  // pinning, lookups, the final rebuild). Only an edit that changes the
  // catalog itself reads it again at the end.
  // Pin every resolved evidence line to its input first, so an edit can
  // never lose which Excel line a recipe line came from.
  // Only edits that change file lines by position need it.
  if (PIN_ACTIONS.has(action.action)) {
    const pinned = await build(readCtx, loaded, evidenceLines);
    for (const pinnedLine of pinned.lines) {
      if (pinnedLine.input_id && pinnedLine.evidence_index !== null) {
        evidenceLines[pinnedLine.evidence_index].input_id = pinnedLine.input_id;
      }
    }
  }
  const costing = await readCtx.store.loadCosting(ctx.companyId);
  const { data } = costing;
  const itemExists = (kind: "ingredient" | "component", id: string) =>
    kind === "ingredient"
      ? data.ingredientsById.has(id)
      : data.componentsById.has(id);
  const nameOfItem = (kind: "ingredient" | "component", id: string) =>
    (kind === "ingredient"
      ? data.ingredientsById.get(id)?.name
      : data.componentsById.get(id)?.name) ?? "";

  const lineByKey = async (key: string) => {
    const built = await build(readCtx, loaded, evidenceLines);
    return built.lines.find((line) => line.key === key) ?? null;
  };

  // Mark the evidence line behind an unresolved editor line as resolved.
  const bind = (
    line: EditorLine,
    input: VersionInput,
    name: string,
    kind: "ingredient" | "component"
  ) => {
    const target =
      line.evidence_index !== null
        ? evidenceLines[line.evidence_index]
        : undefined;
    if (!target) return;
    target.input_id = input.id;
    target.pending = false;
    target.flags = [];
    target.ingredient_match = kind === "ingredient" ? name : null;
    target.sub_recipe_match = kind === "component" ? name : null;
  };

  switch (action.action) {
    case "add": {
      const qty = cleanQuantity(action.quantity);
      const unit = cleanUnit(action.unit);
      if (!qty || !unit) {
        return {
          ok: false,
          error: "Indica una cantidad y una unidad válidas.",
          status: 400,
        };
      }
      if (!itemExists(action.kind, action.id)) {
        return {
          ok: false,
          error: "Ese ingrediente no está en tu lista.",
          status: 400,
        };
      }
      await ctx.store.insertInput(ctx.companyId, version!, {
        input_type: action.kind,
        ingredient_id: action.kind === "ingredient" ? action.id : null,
        component_id: action.kind === "component" ? action.id : null,
        quantity: qty,
        unit,
      });
      break;
    }
    case "update": {
      const patch: { quantity?: number; unit?: string } = {};
      if (action.quantity !== undefined) {
        const qty = cleanQuantity(action.quantity);
        if (!qty)
          return {
            ok: false,
            error: "La cantidad tiene que ser mayor que cero.",
            status: 400,
          };
        patch.quantity = qty;
      }
      if (action.unit !== undefined) {
        const unit = cleanUnit(action.unit);
        if (!unit)
          return { ok: false, error: "Esa unidad no es válida.", status: 400 };
        patch.unit = unit;
      }
      const inputs = await ctx.store.listInputs(ctx.companyId, version!);
      const current = inputs.find((row) => row.id === action.input_id);
      if (!current) {
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      }
      if (patch.unit && patch.unit !== current.unit) {
        Object.assign(patch, clearedOwnCost(current));
      }
      await ctx.store.updateInput(
        ctx.companyId,
        version!,
        action.input_id,
        patch
      );
      break;
    }
    case "set_yield": {
      const qty = cleanQuantity(action.quantity);
      const unit = cleanUnit(action.unit);
      if (!qty || !unit) {
        return {
          ok: false,
          error: "Indica cuánto rinde, con una unidad válida.",
          status: 400,
        };
      }
      await ctx.store.setPreparationYield(ctx.companyId, version!, {
        quantity: qty,
        unit,
      });
      evidenceYield = {
        value: qty,
        unit,
        source: "confirmed",
        confirmed: true,
      };
      break;
    }
    case "answer_unit": {
      const unit = cleanUnit(action.unit);
      if (!unit) {
        return { ok: false, error: "Esa unidad no es válida.", status: 400 };
      }
      const inputs = await ctx.store.listInputs(ctx.companyId, version!);
      const current = inputs.find((row) => row.id === action.input_id);
      if (!current) {
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      }
      await ctx.store.updateInput(ctx.companyId, version!, action.input_id, {
        unit,
        ...(unit !== current.unit ? clearedOwnCost(current) : {}),
      });
      for (const line of evidenceLines) {
        if (line.input_id === action.input_id) line.unit_question = null;
      }
      break;
    }
    case "change_item": {
      if (!itemExists(action.kind, action.id)) {
        return {
          ok: false,
          error: "Ese ingrediente no está en tu lista.",
          status: 400,
        };
      }
      const inputs = await ctx.store.listInputs(ctx.companyId, version!);
      const current = inputs.find((row) => row.id === action.input_id);
      if (!current) {
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      }
      await ctx.store.updateInput(ctx.companyId, version!, action.input_id, {
        input_type: action.kind,
        ingredient_id: action.kind === "ingredient" ? action.id : null,
        component_id: action.kind === "component" ? action.id : null,
        ...clearedOwnCost(current),
      });
      // The cached line must follow the new item.
      evidenceLines = evidenceLines.map((line) =>
        line.input_id === action.input_id
          ? {
              ...line,
              ingredient_match:
                action.kind === "ingredient"
                  ? nameOfItem(action.kind, action.id)
                  : null,
              sub_recipe_match:
                action.kind === "component"
                  ? nameOfItem(action.kind, action.id)
                  : null,
            }
          : line
      );
      break;
    }
    case "resolve": {
      const line = await lineByKey(action.line_key);
      if (!line || line.kind !== "unresolved") {
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      }
      if (!itemExists(action.kind, action.id)) {
        return {
          ok: false,
          error: "Ese ingrediente no está en tu lista.",
          status: 400,
        };
      }
      const amount = amountForLine(
        line,
        { quantity: action.quantity, unit: action.line_unit },
        "unit"
      );
      if (!amount) {
        return { ok: false, error: TYPE_QUANTITY_FIRST, status: 400 };
      }
      const row = await ctx.store.insertInput(ctx.companyId, version!, {
        input_type: action.kind,
        ingredient_id: action.kind === "ingredient" ? action.id : null,
        component_id: action.kind === "component" ? action.id : null,
        quantity: amount.quantity,
        unit: amount.unit,
      });
      const name = nameOfItem(action.kind, action.id);
      bind(line, row, name, action.kind);
      if (
        action.kind === "ingredient" &&
        normalizeMatchName(line.raw_name) !== normalizeMatchName(name)
      ) {
        await rememberQuietly(ctx, line.raw_name, action.id);
      }
      break;
    }
    case "remove": {
      const line = await lineByKey(action.line_key);
      if (!line)
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      if (line.input_id) {
        await ctx.store.deleteInput(ctx.companyId, version!, line.input_id);
        // Also drop any unbound file line of the same name, so the item
        // does not come back as a pending twin.
        const sameName = new Set(
          [line.raw_name, line.name ?? ""]
            .map((name) => normalizeMatchName(name))
            .filter(Boolean)
        );
        evidenceLines = evidenceLines.filter(
          (l) =>
            l.input_id !== line.input_id &&
            !(!l.input_id && sameName.has(normalizeMatchName(l.raw_name)))
        );
        // The assumed yield shown on the screen belonged to a preparation
        // line. With the last one removed it no longer applies, so it
        // cannot block approving the dish.
        const yieldNow = asYieldRecord(holder.evidence.yield);
        const preparationLeft = evidenceLines.some((l) => l.sub_recipe_match);
        if (
          line.kind === "component" &&
          !preparationLeft &&
          yieldNow &&
          (yieldNow.source === "assumed" || yieldNow.confirmed === false)
        ) {
          evidenceYield = {
            ...yieldNow,
            source: "preparation_removed",
            confirmed: true,
          };
        }
      } else {
        const target =
          line.evidence_index !== null
            ? evidenceLines[line.evidence_index]
            : undefined;
        evidenceLines = evidenceLines.filter((l) => l !== target);
      }
      break;
    }
    case "create_ingredient": {
      // A menu line needs its quantity typed before anything is created.
      if (action.line_key) {
        const target = await lineByKey(action.line_key);
        if (
          target?.kind === "unresolved" &&
          !amountForLine(
            target,
            { quantity: action.quantity, unit: action.line_unit },
            "unit"
          )
        ) {
          return { ok: false, error: TYPE_QUANTITY_FIRST, status: 400 };
        }
      }
      const name =
        typeof action.name === "string"
          ? action.name.trim().replace(/\s+/g, " ")
          : "";
      const unit = cleanUnit(action.unit);
      if (!name || name.length > MAX_NAME) {
        return {
          ok: false,
          error: "Escribe el nombre del ingrediente.",
          status: 400,
        };
      }
      if (!unit) {
        return {
          ok: false,
          error: "Elige la unidad en la que lo compras.",
          status: 400,
        };
      }
      const price =
        action.unit_cost === undefined ? null : cleanPrice(action.unit_cost);
      if (action.unit_cost !== undefined && price === null) {
        return {
          ok: false,
          error: "El precio no puede ser negativo.",
          status: 400,
        };
      }
      const existing = [...data.ingredientsById.values()].find(
        (row) => normalizeMatchName(row.name) === normalizeMatchName(name)
      );
      if (existing) {
        return {
          ok: false,
          error: `Ya existe un ingrediente llamado «${existing.name}». Elígelo de la lista.`,
          status: 409,
        };
      }
      const currency = await ctx.store.currency(ctx.companyId);
      const created = await ctx.store.createIngredient(ctx.companyId, {
        name,
        defaultUnit: unit,
        currency,
      });
      if (price !== null) {
        const added = await ctx.store.addCostEntry(ctx.companyId, {
          ingredientId: created.id,
          unit,
          unitCost: price,
          currency,
          date: new Date().toISOString().slice(0, 10),
          dateSource: "manual",
          note:
            price === 0
              ? ZERO_PRICE_NOTE
              : "Precio al crear el ingrediente en Recetas y costeo",
        });
        if (!added.ok)
          return {
            ok: false,
            error: added.error,
            status: 400,
            conversion: added.conversion,
          };
      }
      if (action.line_key) {
        const line = await lineByKey(action.line_key);
        if (line && line.kind === "unresolved") {
          const amount = amountForLine(
            line,
            { quantity: action.quantity, unit: action.line_unit },
            unit
          )!;
          const row = await ctx.store.insertInput(ctx.companyId, version!, {
            input_type: "ingredient",
            ingredient_id: created.id,
            component_id: null,
            quantity: amount.quantity,
            unit: amount.unit,
          });
          bind(line, row, created.name, "ingredient");
          if (normalizeMatchName(line.raw_name) !== normalizeMatchName(name)) {
            await rememberQuietly(ctx, line.raw_name, created.id);
          }
        }
      } else if (action.quantity !== undefined) {
        const qty = cleanQuantity(action.quantity);
        const lineUnit = cleanUnit(action.line_unit ?? unit);
        if (qty && lineUnit) {
          await ctx.store.insertInput(ctx.companyId, version!, {
            input_type: "ingredient",
            ingredient_id: created.id,
            component_id: null,
            quantity: qty,
            unit: lineUnit,
          });
        }
      }
      break;
    }
    case "answer_catalog_unit": {
      if (action.unit === NO_PRICE_ANSWER) {
        const skipped = await ctx.store.skipCatalogQuestion(
          ctx.companyId,
          action.item_id
        );
        if (!skipped.ok) {
          return { ok: false, error: skipped.reason, status: 400 };
        }
        break; // the line stays Pendiente
      }
      const answered = await ctx.store.answerCatalogQuestion(
        ctx.companyId,
        action.item_id,
        action.unit
      );
      if (!answered.ok) {
        return { ok: false, error: answered.reason, status: 400 };
      }
      if (action.line_key && version?.status === "in_review") {
        const line = await lineByKey(action.line_key);
        // A menu line without its quantity stays pending; the answer
        // about the price list is kept either way.
        const amount =
          line && line.kind === "unresolved"
            ? amountForLine(line, {}, action.unit)
            : null;
        if (line && amount) {
          const row = await ctx.store.insertInput(ctx.companyId, version, {
            input_type: "ingredient",
            ingredient_id: answered.ingredientId,
            component_id: null,
            quantity: amount.quantity,
            unit: amount.unit,
          });
          const fresh = await ctx.store.loadCosting(ctx.companyId);
          bind(
            line,
            row,
            fresh.data.ingredientsById.get(answered.ingredientId)?.name ??
              line.raw_name,
            "ingredient"
          );
        }
      }
      break;
    }
    case "create_preparation": {
      // A menu line needs its quantity typed before anything is created.
      if (action.line_key) {
        const target = await lineByKey(action.line_key);
        if (
          target?.kind === "unresolved" &&
          !amountForLine(
            target,
            { quantity: action.quantity, unit: action.line_unit },
            "unit"
          )
        ) {
          return { ok: false, error: TYPE_QUANTITY_FIRST, status: 400 };
        }
      }
      const name =
        typeof action.name === "string"
          ? action.name.trim().replace(/\s+/g, " ")
          : "";
      const yieldQty = cleanQuantity(action.yield_quantity);
      const yieldUnit = cleanUnit(action.yield_unit);
      if (!name || name.length > MAX_NAME) {
        return {
          ok: false,
          error: "Escribe el nombre de la preparación.",
          status: 400,
        };
      }
      if (!yieldQty || !yieldUnit) {
        return {
          ok: false,
          error: "Indica cuánto rinde la preparación, con una unidad válida.",
          status: 400,
        };
      }
      const key = normalizeMatchName(name);
      const samePrep = [...data.componentsById.values()].find(
        (row) => normalizeMatchName(row.name) === key
      );
      if (samePrep) {
        return {
          ok: false,
          error: `Ya existe una preparación llamada «${samePrep.name}». Elígela de la lista.`,
          status: 409,
        };
      }
      const created = await ctx.store.createPreparation(ctx.companyId, {
        name,
        outputQuantity: yieldQty,
        outputUnit: yieldUnit,
      });
      if (action.line_key) {
        const line = await lineByKey(action.line_key);
        if (line && line.kind === "unresolved") {
          const amount = amountForLine(
            line,
            { quantity: action.quantity, unit: action.line_unit },
            yieldUnit
          )!;
          const row = await ctx.store.insertInput(ctx.companyId, version!, {
            input_type: "component",
            ingredient_id: null,
            component_id: created.id,
            quantity: amount.quantity,
            unit: amount.unit,
          });
          bind(line, row, created.name, "component");
        }
      } else if (action.quantity !== undefined) {
        const qty = cleanQuantity(action.quantity);
        const lineUnit = cleanUnit(action.line_unit ?? yieldUnit);
        if (!qty || !lineUnit) {
          return {
            ok: false,
            error: "Indica cuánto lleva el plato, con una unidad válida.",
            status: 400,
          };
        }
        await ctx.store.insertInput(ctx.companyId, version!, {
          input_type: "component",
          ingredient_id: null,
          component_id: created.id,
          quantity: qty,
          unit: lineUnit,
        });
      }
      break;
    }
    case "set_line_cost": {
      const inputs = await ctx.store.listInputs(ctx.companyId, version!);
      const row = inputs.find((r) => r.id === action.input_id);
      if (!row) {
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      }
      const cost =
        action.unit_cost === null ? null : cleanPrice(action.unit_cost);
      if (action.unit_cost !== null && cost === null) {
        return {
          ok: false,
          error: "El precio no puede ser negativo.",
          status: 400,
        };
      }
      // An ingredient has ONE price record (R1-09b, D7): a price typed on
      // the line is a manual, dated cost entry for that ingredient, in the
      // line's unit, and the line drops its own copy so it reads it.
      if (
        cost !== null &&
        row.input_type === "ingredient" &&
        row.ingredient_id
      ) {
        const currency = await ctx.store.currency(ctx.companyId);
        const added = await ctx.store.addCostEntry(ctx.companyId, {
          ingredientId: row.ingredient_id,
          unit: row.unit,
          unitCost: cost,
          currency,
          date: new Date().toISOString().slice(0, 10),
          dateSource: "manual",
          note: cost === 0 ? ZERO_PRICE_NOTE : "Precio corregido en Platos",
        });
        if (!added.ok)
          return {
            ok: false,
            error: added.error,
            status: 400,
            conversion: added.conversion,
          };
        // The rebuild below reads the catalog loaded at the start of this
        // edit: add the new entry to it instead of loading it again.
        const today = new Date().toISOString().slice(0, 10);
        const entries =
          data.costEntriesByIngredientId.get(row.ingredient_id) ?? [];
        entries.push({
          id: `nuevo:${row.id}`,
          company_id: ctx.companyId,
          ingredient_id: row.ingredient_id,
          supplier_id: null,
          source_type: "manual",
          source_id: null,
          cost_date: today,
          effective_date: today,
          date_source: "manual",
          quantity: 1,
          unit: row.unit,
          total_cost: cost,
          unit_cost: cost,
          normalized_unit: normalizeUnit(row.unit) ?? row.unit,
          normalized_unit_cost: cost,
          currency,
          created_at: new Date().toISOString(),
        });
        data.costEntriesByIngredientId.set(row.ingredient_id, entries);
        if (row.unit_cost != null) {
          await ctx.store.updateInput(ctx.companyId, version!, row.id, {
            unit_cost: null,
            cost_source: null,
          });
        }
        break;
      }
      // A preparation line (no price record of its own) or "usar la
      // lista" (null): only this line.
      await ctx.store.updateInput(ctx.companyId, version!, action.input_id, {
        unit_cost: cost,
        cost_source: cost === null ? null : "manual",
      });
      break;
    }
    case "set_price": {
      const price = cleanPrice(action.unit_cost);
      // A unit outside the table («taza») is accepted when the ingredient
      // has a unit of its own: saving then converts it with the ingredient's
      // conversion, or answers with «Definir conversión». Never stored as is.
      let unit = cleanUnit(action.unit);
      if (!unit && typeof action.unit === "string") {
        const raw = action.unit.trim();
        const ing = data.ingredientsById.get(action.ingredient_id);
        if (raw && raw.length <= 24 && ing?.default_unit) unit = raw;
      }
      if (price === null || !unit) {
        return {
          ok: false,
          error: "Indica un precio y una unidad válidos.",
          status: 400,
        };
      }
      if (!data.ingredientsById.has(action.ingredient_id)) {
        return {
          ok: false,
          error: "Ese ingrediente no está en tu lista.",
          status: 400,
        };
      }
      // The screen may be older than a merge: an ingredient that was merged
      // away has no price of its own any more.
      const merged = await ctx.store.mergedInto(
        ctx.companyId,
        action.ingredient_id
      );
      if (merged) {
        return {
          ok: false,
          error: `Este ingrediente se unió con ${merged.name || "otro"}; recarga la receta.`,
          status: 409,
        };
      }
      const currency = await ctx.store.currency(ctx.companyId);
      const added = await ctx.store.addCostEntry(ctx.companyId, {
        keepUnit: action.correct_unit === true,
        ingredientId: action.ingredient_id,
        unit,
        unitCost: price,
        currency,
        date: new Date().toISOString().slice(0, 10),
        dateSource: "manual",
        note:
          price === 0
            ? ZERO_PRICE_NOTE
            : action.adopt_legacy === true
              ? "Adoptado del precio de línea"
              : action.correct_unit === true
                ? "Unidad corregida"
                : "Precio corregido en Recetas y costeo",
      });
      if (!added.ok)
        return {
          ok: false,
          error: added.error,
          status: 400,
          conversion: added.conversion,
        };
      break;
    }
  }

  // Rebuild what the screen, the checklist and approval read.
  const nextHolder: Loaded = evidenceYield
    ? {
        ...loaded,
        holder: {
          ...holder,
          evidence: { ...holder.evidence, yield: evidenceYield },
        },
      }
    : loaded;
  const built = await build(
    CATALOG_ACTIONS.has(action.action) ? ctx : readCtx,
    nextHolder,
    evidenceLines
  );
  if (version) {
    await ctx.store.saveEvidence(
      ctx.companyId,
      nextHolder.holder,
      rebuildEvidence(nextHolder.holder.evidence, built.lines)
    );
  }
  return { ok: true, state: built.state };
}

async function rememberQuietly(
  ctx: Ctx,
  aliasName: string,
  ingredientId: string
) {
  try {
    await ctx.store.rememberAlias({
      companyId: ctx.companyId,
      aliasName,
      ingredientId,
      userId: ctx.userId,
    });
  } catch (err) {
    // No alias table yet (migration 039 pending): never block the edit.
    console.error("[recipe-editor alias]", err);
  }
}

/**
 * Recompute the cached evidence from the recipe's inputs and the catalog,
 * without changing anything else. Used right after suggestions are
 * written, so the first thing a person sees is already costed from the
 * catalog.
 */
export async function refreshEvidence(ctx: Ctx): Promise<EditorResult> {
  const loaded = await load(ctx);
  if (!loaded.ok) return loaded;
  const { holder, version } = loaded;
  const built = await build(ctx, loaded, evidenceLinesOf(holder.evidence));
  if (version && version.status === "in_review") {
    await ctx.store.saveEvidence(
      ctx.companyId,
      holder,
      rebuildEvidence(holder.evidence, built.lines)
    );
  }
  return { ok: true, state: built.state };
}

/** Start the company-wide reads now; a failure surfaces where they are used. */
function warmCatalog(ctx: Ctx): void {
  for (const read of [
    ctx.store.loadCosting(ctx.companyId),
    ctx.store.loadAliases(ctx.companyId),
    ctx.store.catalogQuestions(ctx.companyId),
  ]) {
    read.catch(() => undefined);
  }
}

/** Reuse one catalog read across many products (read-only refreshes). */
export function withCachedCatalog(store: EditorStore): EditorStore {
  const costing = new Map<string, Promise<CostingLoad>>();
  const aliases = new Map<string, Promise<Map<string, string>>>();
  const questions = new Map<string, Promise<CatalogQuestion[]>>();
  return {
    ...store,
    catalogQuestions(companyId) {
      if (!questions.has(companyId)) {
        questions.set(companyId, store.catalogQuestions(companyId));
      }
      return questions.get(companyId)!;
    },
    loadCosting(companyId) {
      if (!costing.has(companyId)) {
        costing.set(companyId, store.loadCosting(companyId));
      }
      return costing.get(companyId)!;
    },
    loadAliases(companyId) {
      if (!aliases.has(companyId)) {
        aliases.set(companyId, store.loadAliases(companyId));
      }
      return aliases.get(companyId)!;
    },
  };
}

// ---------------------------------------------------------------------------
// Approving a preparation
// ---------------------------------------------------------------------------

export async function approvePreparation(
  ctx: Ctx & {
    componentId: string;
    /** Milton staff: how the client confirmed. */
    confirmedHow?: string | null;
    /**
     * R1-13: answer as soon as the preparation is approved. The dishes that
     * use it are re-costed by `recost()` (run it after the response), not
     * before it.
     */
    deferRefresh?: boolean;
  }
): Promise<
  | {
      ok: true;
      state: EditorState;
      refreshed_dishes: number;
      /** Set with deferRefresh: re-cost the dishes that use it, in bulk. */
      recost?: () => Promise<number>;
    }
  | { ok: false; error: string; status?: number }
> {
  // The catalog, aliases and questions are read while the preparation is
  // found, and once for the whole approval.
  const readCtx: Ctx = { ...ctx, store: withCachedCatalog(ctx.store) };
  warmCatalog(readCtx);
  const loaded = await load(readCtx);
  if (!loaded.ok) return loaded;
  const { holder, version } = loaded;
  if (!version) {
    return {
      ok: false,
      error: "Esta preparación no tiene receta.",
      status: 400,
    };
  }
  if (version.status !== "in_review") {
    return {
      ok: false,
      error: "Esta preparación ya está aprobada.",
      status: 409,
    };
  }
  const built = await build(readCtx, loaded, evidenceLinesOf(holder.evidence));
  const checklist = built.state.preparation?.checklist;
  if (!checklist?.ready) {
    return {
      ok: false,
      error: checklist?.blockers[0] ?? "La preparación no pasa el checklist.",
      status: 400,
    };
  }
  const denied = await ctx.guard;
  if (denied) return denied;
  if (!ctx.userId) {
    return { ok: false, error: "Falta quién aprueba.", status: 400 };
  }
  await ctx.store.approvePreparationVersion(
    ctx.companyId,
    version,
    approvalRecord({ userId: ctx.userId, how: ctx.confirmedHow })
  );
  await ctx.store.resolveHolder(ctx.companyId, holder);

  // The approved preparation as the screen shows it: same lines, locked.
  const approvedState: EditorState = {
    ...built.state,
    editable: false,
    locked_reason:
      "Esta preparación ya está aprobada. Para cambiarla hace falta una versión nueva.",
    preparation: built.state.preparation
      ? { ...built.state.preparation, status: "approved" }
      : built.state.preparation,
  };

  // Dishes that use it now have a cost for that line. One catalog read
  // for all of them, a few at a time (they were re-costed one by one, each
  // reading everything again).
  const recost = async (): Promise<number> => {
    const dishes = await ctx.store.dishesUsingPreparation(
      ctx.companyId,
      ctx.componentId
    );
    const shared = withCachedCatalog(ctx.store);
    let refreshed = 0;
    for (let i = 0; i < dishes.length; i += RECOST_CONCURRENCY) {
      await Promise.all(
        dishes.slice(i, i + RECOST_CONCURRENCY).map(async (dish) => {
          try {
            const r = await refreshEvidence({
              store: shared,
              companyId: ctx.companyId,
              odooProductId: dish.odooProductId,
              locationId: dish.locationId,
              userId: ctx.userId,
            });
            if (r.ok) refreshed += 1;
          } catch (err) {
            console.error("[preparation approve refresh]", err);
          }
        })
      );
    }
    return refreshed;
  };

  if (ctx.deferRefresh) {
    return { ok: true, state: approvedState, refreshed_dishes: 0, recost };
  }
  const refreshed = await recost();
  return { ok: true, state: approvedState, refreshed_dishes: refreshed };
}

/** Dishes re-costed at once after a preparation is approved. */
const RECOST_CONCURRENCY = 4;
