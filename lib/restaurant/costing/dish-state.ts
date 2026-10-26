// lib/restaurant/costing/dish-state.ts
//
// ONE rule for a dish's status, cost and coverage. dish-economics (ranking,
// Cockpit, Ventas, Menú › Platos, Costos KPIs), the editor's dish summary and
// the optimistic «Aprobar» all call it; nothing else sets "aprobado" or
// `covered`. Pure (no I/O, no React).
//
// The rule
//   * The version a dish is costed with is the APPROVED one in force
//     (`pickApprovedVersion`: the first approved covers all history, a later
//     approved wins from its effective_date) — the same pick the costing engine
//     makes — or the newest draft when nothing is approved.
//   * aprobado = an approved version in force + EVERY line priced.
//   * covered (counts in coverage and COGS) additionally needs the POS link
//     CONFIRMED. DECISION: an approved recipe whose link is not confirmed is still
//     "aprobado" (the recipe IS approved and its cost is known) but covered=false
//     with reason "vinculo_sin_confirmar", and the label says
//     «Aprobado · vínculo sin confirmar». It used to fall into "estimado", which
//     hid an approved recipe behind an estimate and made the detail and the
//     ranking disagree.
//   * Any line without a price = «Falta precio», never a partial total or $0.
//   * No version / no lines = «Sin receta». EXCEPT an `in_review` version with
//     no lines (menu-reader drafts, an empty recipe from «Crear receta») =
//     «Borrador»: never covered, never in COGS, never «costeado».
//   * A draft (AI or import) with every price known is an «Estimado».
//   * Treatments with their own rule: modificador_sin_costo (costed at zero on
//     purpose) and combo (costed by its parts).

import { pickApprovedVersion } from "@/lib/restaurant/recipe-versions";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";
import { DISH_STATUS_LABELS, type DishStatus } from "./dish-status";

export type DishStateReason = "vinculo_sin_confirmar" | "desde_el_menu";

/** The notes of a draft the menu reader prepares (menu-reading/server.ts). */
export const MENU_DRAFT_NOTE = "Borrador desde el menú";
/** Sub-label / tooltip of a «Borrador» that came from the menu reader. */
export const FROM_MENU_LABEL = "desde el menú";

export const UNCONFIRMED_LINK_LABEL = "Aprobado · vínculo sin confirmar";

export interface StateVersion {
  id: string;
  version_number: number;
  status: string;
  effective_date: string | null;
  approved_at?: string | null;
  created_at?: string | null;
  notes?: string | null;
}

/** The newest version (the draft the editor shows). */
export function newestVersion<T extends { version_number: number }>(
  rows: readonly T[]
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (!best || row.version_number > best.version_number) best = row;
  }
  return best;
}

/**
 * The versions of a dish: the approved one in force (the engine's pick), the
 * newest, and the one the dish is costed with.
 */
export function pickDishVersions<T extends StateVersion>(
  versions: readonly T[],
  asOfDate?: string | null
): { approved: T | null; newest: T | null; version: T | null } {
  const approved = pickApprovedVersion([...versions], asOfDate ?? null);
  const newest = newestVersion(versions);
  return { approved, newest, version: approved ?? newest };
}

/** What the rule needs once the lines of the chosen version are known. */
export interface DishStateCore {
  has_version: boolean;
  line_count: number;
  /** Lines with no price. */
  missing: number;
  /** Total of the lines; null when any line has no price. */
  total: number | null;
  /** An approved version is in force. */
  approved: boolean;
  /** The POS link is confirmed. */
  confirmed: boolean;
  treatment: PosProductClassification;
  /** The list's rule for a combo (covered when every part is costed). */
  combo_covered?: boolean;
  in_food_sales: boolean;
  /** Net price per unit sold (for the food cost %). */
  avg_net_price: number | null;
  /** The version in use is an `in_review` draft (matters only with no lines). */
  in_review?: boolean;
  /** …and its notes are exactly MENU_DRAFT_NOTE. */
  from_menu?: boolean;
}

export interface DishState {
  status: DishStatus;
  status_label: string;
  unit_cost: number | null;
  food_cost_pct: number | null;
  covered: boolean;
  in_cogs: boolean;
  reason: DishStateReason | null;
  cost_source: "receta_aprobada" | "borrador" | "partes" | "sin_costo" | null;
}

export function dishStateFrom(core: DishStateCore): DishState {
  let status: DishStatus;
  let unitCost: number | null = null;
  let costSource: DishState["cost_source"] = null;
  let reason: DishStateReason | null = null;

  if (core.treatment === "modificador_sin_costo") {
    status = "aprobado";
    unitCost = 0;
    costSource = "sin_costo";
  } else if (core.treatment === "combo" && !core.approved) {
    // A combo is costed by its parts; covered when they all are.
    status = core.combo_covered ? "aprobado" : "sin_receta";
    costSource = core.combo_covered ? "partes" : null;
  } else if (!core.has_version || core.line_count === 0) {
    // An in_review version with no lines is a «Borrador»; anything else here
    // (no version, or an empty approved/legacy one) is «Sin receta».
    const emptyDraft =
      core.has_version && !core.approved && core.in_review === true;
    status = emptyDraft ? "borrador" : "sin_receta";
    if (emptyDraft && core.from_menu) reason = "desde_el_menu";
  } else if (core.total === null || core.missing > 0) {
    status = "falta_precio";
    costSource = core.approved ? "receta_aprobada" : "borrador";
  } else if (core.approved) {
    status = "aprobado";
    unitCost = core.total;
    costSource = "receta_aprobada";
    if (!core.confirmed) reason = "vinculo_sin_confirmar";
  } else {
    // A draft (AI or import) with every price known: an estimate.
    status = "estimado";
    unitCost = core.total;
    costSource = "borrador";
  }

  const foodCostPct =
    unitCost !== null && core.avg_net_price !== null && core.avg_net_price > 0
      ? (unitCost / core.avg_net_price) * 100
      : null;
  const special =
    core.treatment === "modificador_sin_costo" ||
    (core.treatment === "combo" && !core.approved);
  const covered =
    status === "aprobado" &&
    core.in_food_sales &&
    (special ? true : core.confirmed) &&
    (core.treatment !== "combo" || core.approved || !!core.combo_covered);
  return {
    status,
    status_label:
      reason === "vinculo_sin_confirmar"
        ? UNCONFIRMED_LINK_LABEL
        : DISH_STATUS_LABELS[status],
    unit_cost: unitCost,
    food_cost_pct: foodCostPct,
    covered,
    in_cogs: covered && unitCost !== null,
    reason,
    cost_source: costSource,
  };
}

/** The two flags dishStateFrom needs about the version a dish is costed with. */
export function draftFlags(
  version: { status: string; notes?: string | null } | null | undefined
): { in_review: boolean; from_menu: boolean } {
  return {
    in_review: version?.status === "in_review",
    from_menu: (version?.notes ?? "").trim() === MENU_DRAFT_NOTE,
  };
}

export interface ResolveDishStateInput {
  versions: readonly StateVersion[];
  link: { link_state: string } | null;
  treatment: PosProductClassification;
  /** The lines of the version this dish is costed with (see pickDishVersions). */
  lines: ReadonlyArray<{ pending: boolean; amount: number | null }>;
  units_sold: number;
  net_sales: number;
  in_food_sales?: boolean;
  combo_covered?: boolean;
  asOfDate?: string | null;
}

export interface ResolvedDishState extends DishState {
  approved_version_id: string | null;
  /** The version the lines belong to (approved in force, else the newest). */
  version_id: string | null;
}

/**
 * The status, cost and coverage of one dish from its versions, its link and
 * the lines of the version it is costed with.
 */
export function resolveDishState(
  input: ResolveDishStateInput
): ResolvedDishState {
  const { approved, version } = pickDishVersions(
    input.versions,
    input.asOfDate
  );
  const missing = input.lines.filter(
    (l) => l.pending || l.amount === null
  ).length;
  const total =
    input.lines.length === 0 || missing > 0
      ? null
      : input.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const state = dishStateFrom({
    has_version: version !== null,
    line_count: input.lines.length,
    missing,
    total,
    approved: approved !== null,
    confirmed: input.link?.link_state === "confirmado",
    treatment: input.treatment,
    combo_covered: input.combo_covered,
    in_food_sales: input.in_food_sales ?? true,
    avg_net_price:
      input.units_sold > 0 ? input.net_sales / input.units_sold : null,
    ...draftFlags(version),
  });
  return {
    ...state,
    approved_version_id: approved?.id ?? null,
    version_id: version?.id ?? null,
  };
}
