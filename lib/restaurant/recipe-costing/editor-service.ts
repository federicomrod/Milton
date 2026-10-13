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

import type { CostingData } from "@/lib/restaurant/costing";
import {
  normalizeMatchName,
  bestNameMatch,
} from "@/lib/restaurant/cost-workbook/names";
import { normalizeUnit } from "@/lib/restaurant/units";
import { matchExistingIngredient } from "./ingredient-match";
import {
  buildPickerOptions,
  hydrateLines,
  latestPrice,
  rebuildEvidence,
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

export interface VersionRef {
  id: string;
  status: string;
  menu_item_id: string;
}

export interface CostingLoad {
  data: CostingData;
  /** Human label for where an entry's price came from. */
  sourceOf(entryId: string | undefined): string;
}

export interface NewCostEntry {
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
  loadLink(
    companyId: string,
    odooProductId: number,
    locationId: string | null
  ): Promise<LinkRef | null>;
  saveEvidence(
    companyId: string,
    linkId: string,
    evidence: Record<string, unknown>
  ): Promise<void>;
  latestVersion(
    companyId: string,
    menuItemId: string
  ): Promise<VersionRef | null>;
  listInputs(companyId: string, versionId: string): Promise<VersionInput[]>;
  insertInput(
    companyId: string,
    versionId: string,
    row: Omit<VersionInput, "id">
  ): Promise<VersionInput>;
  updateInput(
    companyId: string,
    versionId: string,
    inputId: string,
    patch: Partial<Omit<VersionInput, "id">>
  ): Promise<void>;
  deleteInput(
    companyId: string,
    versionId: string,
    inputId: string
  ): Promise<void>;
  createIngredient(
    companyId: string,
    input: { name: string; defaultUnit: string; currency: string }
  ): Promise<{ id: string; name: string; default_unit: string | null }>;
  addCostEntry(companyId: string, entry: NewCostEntry): Promise<void>;
  loadAliases(companyId: string): Promise<Map<string, string>>;
  rememberAlias(input: {
    companyId: string;
    aliasName: string;
    ingredientId: string;
    userId: string | null;
  }): Promise<void>;
  currency(companyId: string): Promise<string>;
}

export interface EditorState {
  editable: boolean;
  /** Why it cannot be edited, when it cannot. */
  locked_reason: string | null;
  version_id: string | null;
  lines: EditorLine[];
  options: PickerOption[];
  pending: number;
}

export type EditorResult =
  | { ok: true; state: EditorState }
  | { ok: false; error: string; status?: number };

interface Ctx {
  store: EditorStore;
  companyId: string;
  odooProductId: number;
  locationId: string | null;
  userId: string | null;
}

function evidenceLinesOf(evidence: Record<string, unknown>): EvidenceLineIn[] {
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
        typeof row.ingredient_match === "string" ? row.ingredient_match : null,
      sub_recipe_match:
        typeof row.sub_recipe_match === "string" ? row.sub_recipe_match : null,
      qty: typeof row.qty === "number" ? row.qty : Number(row.qty) || 0,
      unit: typeof row.unit === "string" ? row.unit : "",
      pending:
        row.pending === true || flags.some((f) => f.startsWith("pendiente_")),
      reasons: Array.isArray(row.reasons)
        ? row.reasons.filter((r): r is string => typeof r === "string")
        : [],
      flags,
      input_id: typeof row.input_id === "string" ? row.input_id : null,
    });
  }
  return out;
}

async function build(
  ctx: Ctx,
  link: LinkRef,
  version: VersionRef | null,
  evidenceLines: EvidenceLineIn[]
): Promise<{ state: EditorState; lines: EditorLine[] }> {
  const costing = await ctx.store.loadCosting(ctx.companyId);
  const aliases = await ctx.store.loadAliases(ctx.companyId);
  const { data } = costing;
  const inputs = version
    ? await ctx.store.listInputs(ctx.companyId, version.id)
    : [];

  const ingredientRefs = [...data.ingredientsById.values()].map((row) => ({
    id: row.id,
    name: row.name,
    default_unit: row.default_unit,
  }));
  const componentRefs = [...data.componentsById.values()].map((row) => ({
    id: row.id,
    name: row.name,
  }));
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
      ingredients: new Map(ingredientRefs.map((r) => [r.id, r.name])),
      components: new Map(componentRefs.map((r) => [r.id, r.name])),
      priceOf,
      suggest,
    },
  });

  const editable = version?.status === "in_review";
  return {
    lines,
    state: {
      editable,
      locked_reason: !version
        ? "Este plato todavía no tiene una receta."
        : editable
          ? null
          : "Esta receta ya está aprobada. Para cambiarla hace falta una versión nueva.",
      version_id: version?.id ?? null,
      lines,
      options: buildPickerOptions({ data, priceOf }),
      pending: lines.filter((line) => line.pending).length,
    },
  };
}

async function load(
  ctx: Ctx
): Promise<
  | { ok: false; error: string; status: number }
  | { ok: true; link: LinkRef; version: VersionRef | null }
> {
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
  return { ok: true, link, version };
}

export async function loadEditor(ctx: Ctx): Promise<EditorResult> {
  const loaded = await load(ctx);
  if (!loaded.ok) return loaded;
  const built = await build(
    ctx,
    loaded.link,
    loaded.version,
    evidenceLinesOf(loaded.link.evidence)
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
    }
  | { action: "remove"; line_key: string }
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
    };

const MAX_NAME = 120;

function cleanQuantity(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function cleanUnit(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 24) return null;
  return normalizeUnit(text) ? text : null;
}

export async function applyEdit(
  ctx: Ctx,
  action: EditorAction
): Promise<EditorResult> {
  const loaded = await load(ctx);
  if (!loaded.ok) return loaded;
  const { link, version } = loaded;

  // Prices are not part of a version: setting one is allowed on any recipe.
  if (action.action !== "set_price") {
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

  let evidenceLines = evidenceLinesOf(link.evidence);
  // Pin every resolved evidence line to its input first, so an edit can
  // never lose which Excel line a recipe line came from.
  const pinned = await build(ctx, link, version, evidenceLines);
  for (const pinnedLine of pinned.lines) {
    if (pinnedLine.input_id && pinnedLine.evidence_index !== null) {
      evidenceLines[pinnedLine.evidence_index].input_id = pinnedLine.input_id;
    }
  }
  const costing = await ctx.store.loadCosting(ctx.companyId);
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
    const built = await build(ctx, link, version, evidenceLines);
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
      await ctx.store.insertInput(ctx.companyId, version!.id, {
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
      const inputs = await ctx.store.listInputs(ctx.companyId, version!.id);
      if (!inputs.some((row) => row.id === action.input_id)) {
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      }
      await ctx.store.updateInput(
        ctx.companyId,
        version!.id,
        action.input_id,
        patch
      );
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
      const inputs = await ctx.store.listInputs(ctx.companyId, version!.id);
      if (!inputs.some((row) => row.id === action.input_id)) {
        return { ok: false, error: "No encontré esa línea.", status: 404 };
      }
      await ctx.store.updateInput(ctx.companyId, version!.id, action.input_id, {
        input_type: action.kind,
        ingredient_id: action.kind === "ingredient" ? action.id : null,
        component_id: action.kind === "component" ? action.id : null,
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
      const unit = cleanUnit(line.unit) ?? "unit";
      const qty = cleanQuantity(line.qty) ?? 1;
      const row = await ctx.store.insertInput(ctx.companyId, version!.id, {
        input_type: action.kind,
        ingredient_id: action.kind === "ingredient" ? action.id : null,
        component_id: action.kind === "component" ? action.id : null,
        quantity: qty,
        unit,
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
        await ctx.store.deleteInput(ctx.companyId, version!.id, line.input_id);
        evidenceLines = evidenceLines.filter(
          (l) => l.input_id !== line.input_id
        );
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
        action.unit_cost === undefined ? null : cleanQuantity(action.unit_cost);
      if (action.unit_cost !== undefined && !price) {
        return {
          ok: false,
          error: "El precio tiene que ser mayor que cero.",
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
      if (price) {
        await ctx.store.addCostEntry(ctx.companyId, {
          ingredientId: created.id,
          unit,
          unitCost: price,
          currency,
          date: new Date().toISOString().slice(0, 10),
          dateSource: "manual",
          note: "Precio al crear el ingrediente en Recetas y costeo",
        });
      }
      if (action.line_key) {
        const line = await lineByKey(action.line_key);
        if (line && line.kind === "unresolved") {
          const row = await ctx.store.insertInput(ctx.companyId, version!.id, {
            input_type: "ingredient",
            ingredient_id: created.id,
            component_id: null,
            quantity: cleanQuantity(line.qty) ?? 1,
            unit: cleanUnit(line.unit) ?? unit,
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
          await ctx.store.insertInput(ctx.companyId, version!.id, {
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
    case "set_price": {
      const price = cleanQuantity(action.unit_cost);
      const unit = cleanUnit(action.unit);
      if (!price || !unit) {
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
      const currency = await ctx.store.currency(ctx.companyId);
      await ctx.store.addCostEntry(ctx.companyId, {
        ingredientId: action.ingredient_id,
        unit,
        unitCost: price,
        currency,
        date: new Date().toISOString().slice(0, 10),
        dateSource: "manual",
        note: "Precio corregido en Recetas y costeo",
      });
      break;
    }
  }

  // Rebuild what the screen, the checklist and approval read.
  const built = await build(ctx, link, version, evidenceLines);
  if (version) {
    await ctx.store.saveEvidence(
      ctx.companyId,
      link.id,
      rebuildEvidence(link.evidence, built.lines)
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
