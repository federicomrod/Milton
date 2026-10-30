import { fmt, getDictionary } from "@/lib/i18n";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  localeFor,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import {
  CLASSIFICATION_LABELS,
  LINK_STATE_LABELS,
} from "@/lib/restaurant/pos-product-links";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import type {
  DishEconomics,
  DishEconomicsResult,
  DishStatus,
} from "@/lib/restaurant/costing/dish-economics";
import {
  buildMenuSummary,
  menuDishKpis,
  type MenuDishKpis,
  type MenuSummary,
} from "@/lib/restaurant/costing/menu-summary";
import type { MenuDish } from "@/lib/restaurant/menu-dishes/menu-dishes";
import {
  PICKABLE_TREATMENTS,
  TREATMENT_RULES,
} from "@/lib/restaurant/pos-treatments";
import type { PosProductClassification } from "@/lib/restaurant/pos-product-links";
import { hasApprovedVersion } from "@/lib/restaurant/recipe-versions";
import type { RecipeVersionRecord } from "@/lib/restaurant/recipe-versions";
import {
  canConfirmSuggestedLink,
  isBoundSuggestion,
  isMenuSuggestion,
  parseSuggestionEvidence,
  type SuggestionEvidenceView,
  type SuggestionLineView,
} from "./evidence";
import {
  displayStateForProduct,
  displayStateText,
  evidenceChecklist as evidenceChecklistBase,
  formatUnitsLabel as formatUnitsLabelBase,
  namesAlmostEqual,
  posPriceFromSales,
  productKindLabel,
  productKindText,
  type ChipTone,
  type EvidenceCheckItem,
} from "./display";
import {
  formatMoneyEs as formatMoneyEsBase,
  formatPctLabel,
  round1,
  shareToPct,
} from "./format";
import {
  costingFooter,
  todoKindAction,
  todoKindLabel,
  evidenceSentence as evidenceSentenceBase,
  isAmbiguousEvidence,
  productReason as productReasonBase,
  whoApprovesNote as whoApprovesNoteBase,
  type TodoKind,
} from "./copy";
import {
  buildApprovalChecklist as buildApprovalChecklistBase,
  actorNeedsClientConfirmation,
  toPermissionActor,
  type ApprovalChecklist,
} from "./approval";
import { can, capabilityFlags, type Capability } from "@/lib/auth/capabilities";
import type { PreparationsOverview } from "./preparations-server";
import type { ItemGroupsLoad } from "@/lib/restaurant/groups/item-groups";
import { resolveDishMenuItemId } from "@/lib/restaurant/costing/dish-version";
import {
  FROM_MENU_LABEL,
  pickDishVersions,
} from "@/lib/restaurant/costing/dish-state";
import {
  isUncertainEvidence,
  toReviewLine as toReviewLineBase,
  type ReviewLineView,
  type ReviewItemView,
} from "./review";

export type RecipeCostingView =
  | "resumen"
  /** One dish at a time: link + recipe + approval (was Vincular + Validar). */
  | "plato"
  | "preparaciones"
  | "menu-costeado";

/** Where a dish stands in Plato por plato. */
export type PlatoStatus = "listo" | "por_aprobar" | "borrador" | "sin_receta";

export interface PlatoQueueRow {
  odoo_product_id: number;
  odoo_name: string;
  share_label: string;
  status: PlatoStatus;
  status_label: string;
  status_tone: ChipTone;
  /** «desde el menú» on a Borrador the menu reader prepared. */
  status_note?: string;
  /** The shared loader's status (R1-09a); drives the chip and filters. */
  dish_status?: DishStatus | null;
}

export interface CoverageSlice {
  id: "aprobado" | "por_revisar" | "sin_vincular";
  label: string;
  pct: number;
  color: string;
}

/** Resumen: what has to be in place before costing dishes. */
export interface SetupCheck {
  id: "pos" | "excel" | "platos";
  label: string;
  detail: string;
  done: boolean;
}

/** The coverage goal (premise 10): 90% of food net sales. It is a goal,
 *  not a stop: the flow keeps going past it. */
export const COVERAGE_GOAL_PCT = 90;

export interface TodoRow {
  rank: number;
  odoo_product_id: number;
  odoo_name: string;
  kind: TodoKind;
  kind_label: string;
  action_label: string;
  reason: string;
  share_pct: number;
  share_label: string;
  view: RecipeCostingView;
}

export interface ClassificationRow {
  id: PosProductClassification;
  label: string;
  count: number;
  hint: string;
  /** Share of food net sales; for excluded, share of all net sales. */
  share_label: string;
}

/** A product still waiting for a person to choose its treatment. */
export interface ClassifyQueueRow {
  odoo_product_id: number;
  odoo_name: string;
  share_label: string;
  net_sales_label: string;
  suggested: PosProductClassification;
  suggested_label: string;
  reason: string;
}

export interface VincularProductRow {
  odoo_product_id: number;
  odoo_name: string;
  kind_label: string;
  category: string | null;
  units_sold: number;
  units_label: string;
  pos_price: number | null;
  pos_price_label: string | null;
  net_sales: number;
  net_sales_label: string;
  share_pct: number;
  share_label: string;
  is_combo: boolean;
  components: Array<{
    odoo_product_id: number;
    odoo_name: string;
    net_sales_label: string;
  }>;
  classification: string;
  classification_label: string;
  treatment: PosProductClassification;
  treatment_label: string;
  in_food_sales: boolean;
  suggested_treatment: PosProductClassification | null;
  suggested_treatment_reason: string | null;
  link_state: string;
  link_state_label: string;
  display_state_label: string;
  display_state_tone: ChipTone;
  menu_item_id: string | null;
  recipe_name: string | null;
  evidence_label: string;
  evidence_checks: EvidenceCheckItem[];
  confirmed: boolean;
  can_undo: boolean;
  action_label: string;
  can_confirm_suggestion: boolean;
  suggestion_bound: boolean;
  evidence: SuggestionEvidenceView;
  preview_lines: ReviewLineView[];
  milton_cost_label: string | null;
  excel_total_label: string | null;
  confidence_label: string | null;
  source_label: string | null;
  share_hint: string | null;
}

export interface SuggestionBatchRow {
  id: string;
  filename: string;
  created_at: string | null;
  can_undo: boolean;
  /** Every live batch of this file, newest first (undone together). */
  batch_ids: string[];
  /** How many uploads/runs of the file the row stands for. */
  uploads: number;
}

/**
 * One row per file in "Sugerencias para deshacer": the price list, the
 * recipe import and each suggestion chunk of the same file are one entry.
 * Input newest first; the row keeps the newest batch's date.
 */
/**
 * One key per uploaded file: the same workbook uploaded again (or saved
 * by the browser as "file (2).xlsx", or with a path) is one row.
 */
export function fileGroupKey(filename: string): string {
  return filename
    .replace(/ · recetas$/, "")
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\s*\(\d+\)(?=\.[a-z0-9]+$|$)/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function groupBatchesByFile(
  rows: ReadonlyArray<{
    id: string;
    filename: string;
    created_at?: string | null;
    undone_at: string | null;
  }>
): SuggestionBatchRow[] {
  const byFile = new Map<string, SuggestionBatchRow>();
  for (const row of rows) {
    const file = row.filename.replace(/ · recetas$/, "").trim();
    const key = fileGroupKey(file);
    const group = byFile.get(key);
    if (group) {
      group.batch_ids.push(row.id);
      group.uploads += 1;
      continue;
    }
    byFile.set(key, {
      id: row.id,
      filename: file,
      created_at: row.created_at ?? null,
      can_undo: !row.undone_at,
      batch_ids: [row.id],
      uploads: 1,
    });
  }
  return [...byFile.values()];
}

export interface RecipeCostingWorkspace {
  /** Preparaciones tab only (R1-13): the list, so the tab needs no second read. */
  preparations_overview?: PreparationsOverview | null;
  company_id: string;
  company_name: string | null;
  currency: string;
  period_label: string | null;
  view: RecipeCostingView;
  actor: {
    user_id: string;
    role: string | null;
    is_milton_staff: boolean;
    can_approve: boolean;
    can_submit: boolean;
    needs_client_confirmation: boolean;
    /** Every can() answer for this person (absent in old fixtures). */
    capabilities?: Record<Capability, boolean>;
  };
  coverage: {
    coverage_pct: number;
    coverage_label: string;
    /** Food net sales: the coverage denominator. */
    net_sales: number;
    covered_net_sales: number;
    net_sales_label: string;
    covered_label: string;
    /** Sales a person marked as not food, left out of coverage. */
    excluded_note: string | null;
    dishes_approved: number;
    dishes_need_recipe: number;
    slices: CoverageSlice[];
    margins_note: string;
    goal_pct: number;
    goal_reached: boolean;
    goal_note: string;
  };
  setup_checklist: SetupCheck[];
  /** Menú › Resumen from the shared loader (null on other tabs). */
  menu_summary: MenuSummary | null;
  /** A cost file was picked but not fully saved (044 draft): Resumen
   *  opens the upload step so the choices are right there again. */
  upload_draft_pending: boolean;
  /** The open dish's cost, margin and status from the shared loader. */
  selected_dish: DishSummary | null;
  /** Platos: every dish's numbers, so choosing one needs no server trip. */
  dish_summaries: DishSummary[] | null;
  /** R1-15c: the groups on top of the rows (048); null before it is applied. */
  item_groups: ItemGroupsLoad | null;
  /** R1-15h: the company's restaurants (tags rows, scopes groups) and the one in view (null = Todos). */
  restaurants: Array<{ id: string; name: string }>;
  view_location_id: string | null;
  /** R1-10 Platos: menu dishes with their variants, from the loader. */
  menu_dishes: {
    dishes: MenuDish[];
    excluded: MenuDish[];
    kpis: MenuDishKpis;
    variant_count: number;
    excluded_variant_count: number;
    /** False until migration 045: moves cannot be saved yet. */
    stored: boolean;
    /** Products whose grouping is Milton's and not saved yet. */
    unsaved_variant_count: number;
  } | null;
  next_dish: {
    odoo_product_id: number;
    odoo_name: string;
    view: RecipeCostingView;
    label: string;
  } | null;
  last_progress: string | null;
  todos: TodoRow[];
  todos_total: number;
  classification: ClassificationRow[];
  classify_queue: ClassifyQueueRow[];
  /** Dishes that take a recipe, top sellers first (Plato por plato). */
  plato_queue: PlatoQueueRow[];
  plato_progress: { done: number; total: number; label: string };
  treatment_options: Array<{
    id: PosProductClassification;
    label: string;
    hint: string;
  }>;
  who_approves: string;
  products: VincularProductRow[];
  menu_items: Array<{ id: string; name: string }>;
  batches: SuggestionBatchRow[];
  selected: VincularProductRow | null;
  editor: RecipeEditorView | null;
  footer: string;
  combo_sync_hint: string | null;
  latest_upload: {
    id: string;
    filename: string;
    created_at: string | null;
    has_candidate_blocks: boolean;
  } | null;
  /** "Empezar de nuevo": owner/admin only; what to type to confirm. */
  reset: { prompt: string; warning: string | null } | null;
  costeado_stats: {
    approved_prepared: number;
    excluded: number;
    pending: number;
    excel_matched: number;
    excel_total: number;
  };
  timings?: {
    load_ms: number;
    /** "plato_editor": a reload of the open dish only (no sales scan). */
    path: "full" | "plato_editor";
  };
}

export interface RecipeEditorView {
  odoo_product_id: number;
  odoo_name: string;
  menu_item_id: string | null;
  recipe_version_id: string | null;
  version_label: string;
  /** The POS link and the recipe version are separate states. */
  link_state: string | null;
  recipe_status: PlatoStatus | "aprobada";
  excel_match: "match" | "mismatch" | null;
  category: string | null;
  pos_price_label: string | null;
  units_label: string | null;
  share_label: string;
  margin_label: string | null;
  margin_hint: string | null;
  excel_row_label: string | null;
  /** What the restaurant's menu says, when the draft came from it. */
  menu_source: {
    dish: string;
    description: string | null;
    price_label: string | null;
  } | null;
  milton_cost_label: string | null;
  excel_total_label: string | null;
  variance_note: string | null;
  checklist: ApprovalChecklist;
  lines: ReviewLineView[];
  yield_value: number | null;
  yield_unit: string | null;
  yield_assumed: boolean;
  yield_note: string | null;
  portion_cost_label: string | null;
  review_index: number | null;
  review_total: number;
  next_odoo_product_id: number | null;
}

export interface WorkspaceMenuItem {
  id: string;
  name: string;
  category?: string | null;
  selling_price?: number | null;
}

export interface WorkspaceVersion extends RecipeVersionRecord {
  notes?: string | null;
}

/** Stub ranked products from links — used by Validar so we skip the sales scan. */
export function rankedProductsFromLinks(
  links: readonly PosProductLinkRecord[],
  selectedOdooProductId?: number | null
): RankedPosProduct[] {
  const products = links.map((link) => ({
    odoo_product_id: link.odoo_product_id,
    odoo_name: link.odoo_name,
    net_sales: 0,
    share_of_net_sales: 0,
    units_sold: 0,
    category: null,
    is_combo: false,
    components: [],
    excluded_parts: [],
    classification: link.classification,
    classification_label: CLASSIFICATION_LABELS[link.classification],
    treatment: link.classification,
    suggested_treatment: null,
    in_food_sales: TREATMENT_RULES[link.classification].in_food_sales,
    share_of_food_sales: 0,
    link_state: link.link_state,
    link_state_label: LINK_STATE_LABELS[link.link_state],
    menu_item_id: link.menu_item_id,
    counts_toward_coverage: false,
  }));
  if (
    selectedOdooProductId != null &&
    !products.some((row) => row.odoo_product_id === selectedOdooProductId)
  ) {
    products.unshift({
      odoo_product_id: selectedOdooProductId,
      odoo_name: `Odoo #${selectedOdooProductId}`,
      net_sales: 0,
      share_of_net_sales: 0,
      units_sold: 0,
      category: null,
      is_combo: false,
      components: [],
      excluded_parts: [],
      classification: "por_clasificar",
      classification_label: CLASSIFICATION_LABELS.por_clasificar,
      treatment: "por_clasificar",
      suggested_treatment: null,
      in_food_sales: true,
      share_of_food_sales: 0,
      link_state: "sin_vincular",
      link_state_label: LINK_STATE_LABELS.sin_vincular,
      menu_item_id: null,
      counts_toward_coverage: false,
    });
  }
  return products;
}

export function classifyTodoKind(input: {
  product: RankedPosProduct;
  evidence: SuggestionEvidenceView;
  approved: boolean;
}): TodoKind | null {
  if (input.approved && input.product.link_state === "confirmado") return null;
  const treatment = input.product.treatment;
  if (!TREATMENT_RULES[treatment].needs_recipe && treatment !== "combo") {
    return null;
  }
  if (treatment === "combo" || input.product.is_combo) {
    if (input.product.counts_toward_coverage) return null;
    if (input.product.excluded_parts.length > 0) return "combo";
    return input.product.components.length === 0 ? "combo" : null;
  }
  if (treatment === "reventa" && !input.product.menu_item_id) {
    return "reventa";
  }
  if (
    input.evidence.lines.some((line) => line.pending && line.unit_cost == null)
  ) {
    if (
      input.evidence.lines.some((line) =>
        /costo|precio/i.test(line.reasons.join(" "))
      )
    ) {
      return "falta_precio";
    }
  }
  if (input.evidence.pending || input.evidence.excel_match === "mismatch") {
    return "por_revisar";
  }
  if (isAmbiguousEvidence(input.evidence)) return "ambiguo";
  if (input.product.link_state === "sugerido") {
    return isBoundSuggestion(input.evidence) || isMenuSuggestion(input.evidence)
      ? "sugerido"
      : "sin_receta";
  }
  if (input.product.link_state === "sin_vincular") {
    return isBoundSuggestion(input.evidence) || isMenuSuggestion(input.evidence)
      ? "sugerido"
      : "sin_receta";
  }
  return "por_revisar";
}

function coverageSlices(
  products: readonly RankedPosProduct[],
  lang: PreferredLanguage
): CoverageSlice[] {
  const w = getDictionary(lang).menu.workspace.view;
  // Shares of food net sales: excluded products are not in the bar.
  const food = products.filter((row) => row.in_food_sales);
  const total = food.reduce((sum, row) => sum + row.net_sales, 0);
  const bucket = {
    aprobado: 0,
    por_revisar: 0,
    sin_vincular: 0,
  };
  for (const product of food) {
    if (product.counts_toward_coverage) {
      bucket.aprobado += product.net_sales;
    } else if (
      product.link_state === "sugerido" ||
      (product.link_state === "confirmado" && !product.counts_toward_coverage)
    ) {
      bucket.por_revisar += product.net_sales;
    } else {
      bucket.sin_vincular += product.net_sales;
    }
  }
  const pct = (n: number) => (total === 0 ? 0 : round1((n / total) * 100));
  return [
    {
      id: "aprobado",
      label: w.sliceApproved,
      pct: pct(bucket.aprobado),
      color: "#1f9d55",
    },
    {
      id: "por_revisar",
      label: w.sliceReview,
      pct: pct(bucket.por_revisar),
      color: "#e5e7eb",
    },
    {
      id: "sin_vincular",
      label: w.sliceUnlinked,
      pct: pct(bucket.sin_vincular),
      color: "#93a6e8",
    },
  ];
}

export function buildRecipeCostingWorkspace(input: {
  companyId: string;
  companyName: string | null;
  currency: string;
  periodLabel: string | null;
  view: RecipeCostingView;
  actor: {
    user_id: string;
    role: string | null;
    is_milton_staff: boolean;
  };
  products: readonly RankedPosProduct[];
  links: readonly PosProductLinkRecord[];
  versions: readonly WorkspaceVersion[];
  menuItems: readonly WorkspaceMenuItem[];
  batches: readonly SuggestionBatchRow[];
  coveragePct: number;
  /** Food net sales (coverage denominator). */
  netSales: number;
  excludedNetSales?: number;
  coveredNetSales: number;
  selectedOdooProductId?: number | null;
  lastProgress?: string | null;
  comboSyncHint?: string | null;
  latestUpload?: RecipeCostingWorkspace["latest_upload"];
  reset?: RecipeCostingWorkspace["reset"];
  timings?: RecipeCostingWorkspace["timings"];
  /** Shared dish-economics load: the chip and status of every dish. */
  dishEconomics?: DishEconomicsResult | null;
  restaurants?: Array<{ id: string; name: string }>;
  viewLocationId?: string | null;
  uploadDraftPending?: boolean;
  /** Language of the labels the view carries (default Spanish). */
  lang?: PreferredLanguage;
}): RecipeCostingWorkspace {
  const currency = input.currency || "USD";
  const lang = input.lang ?? RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
  const w = getDictionary(lang).menu.workspace.view;
  const formatMoneyEs = (
    amount: number,
    cur?: string,
    opts?: { decimals?: number }
  ) => formatMoneyEsBase(amount, cur, opts, lang);
  const formatUnitsLabel = (units: number) => formatUnitsLabelBase(units, lang);
  const evidenceSentence = (ev: SuggestionEvidenceView) =>
    evidenceSentenceBase(ev, lang);
  const evidenceChecklist = (
    args: Parameters<typeof evidenceChecklistBase>[0]
  ) => evidenceChecklistBase({ ...args, lang });
  const productReason = (args: Parameters<typeof productReasonBase>[0]) =>
    productReasonBase({ ...args, lang });
  const toReviewLine = (
    line: SuggestionLineView,
    cur?: string,
    portionCost?: number | null
  ) => toReviewLineBase(line, cur, portionCost, lang);
  const treatmentText = (id: PosProductClassification) =>
    treatmentTexts(id, lang);
  const versionsByMenu = new Map<string, WorkspaceVersion[]>();
  for (const version of input.versions) {
    const list = versionsByMenu.get(version.menu_item_id) ?? [];
    list.push(version);
    versionsByMenu.set(version.menu_item_id, list);
  }
  const menuById = new Map(input.menuItems.map((row) => [row.id, row]));
  const linkByProduct = new Map<number, PosProductLinkRecord>();
  for (const link of input.links) {
    if (link.company_id !== input.companyId) continue;
    linkByProduct.set(link.odoo_product_id, link);
  }

  const products: VincularProductRow[] = input.products.map((product) => {
    const link = linkByProduct.get(product.odoo_product_id);
    const evidence = parseSuggestionEvidence(link?.evidence);
    const fromMenu = isMenuSuggestion(evidence);
    const bound = isBoundSuggestion(evidence) || fromMenu;
    const canConfirm = canConfirmSuggestedLink(evidence);
    // The recipe id: the list row's own, or the link's (dish-version.ts).
    const recipeId = resolveDishMenuItemId(
      product.menu_item_id,
      link?.menu_item_id
    );
    const menu = recipeId ? menuById.get(recipeId) : undefined;
    const recipeName = menu?.name ?? evidence.block_name;
    const kind = productKindLabel({
      name: product.odoo_name,
      is_combo: product.is_combo,
      classification: product.treatment,
      category: product.category ?? menu?.category ?? null,
    });
    const unitsSold = product.units_sold ?? 0;
    const posPrice =
      menu?.selling_price && menu.selling_price > 0
        ? menu.selling_price
        : posPriceFromSales(product.net_sales, unitsSold);
    const ambiguous = isAmbiguousEvidence(evidence);
    const display = displayStateForProduct({
      confirmed: product.link_state === "confirmado",
      is_combo: product.is_combo,
      classification: product.treatment,
      kind_label: kind,
      ambiguous,
      suggested: product.link_state === "sugerido",
      bound,
      recipe_name: recipeName ?? null,
    });
    const sourceLabel = fromMenu
      ? w.fromMenu
      : bound
        ? [
            evidence.tab
              ? fmt(getDictionary(lang).menu.workspace.copy.evidence.sheet, {
                  tab: evidence.tab,
                })
              : null,
            evidence.lines.some((line) => line.source_row != null)
              ? fmt(w.row, {
                  row: String(
                    evidence.lines.find((line) => line.source_row != null)
                      ?.source_row
                  ),
                })
              : null,
          ]
            .filter(Boolean)
            .join(", ")
        : null;
    return {
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      kind_label: productKindText(kind, lang),
      category: product.category ?? menu?.category ?? null,
      units_sold: unitsSold,
      units_label: formatUnitsLabel(unitsSold),
      pos_price: posPrice,
      pos_price_label:
        posPrice != null ? formatMoneyEs(posPrice, currency) : null,
      net_sales: product.net_sales,
      net_sales_label: formatMoneyEs(product.net_sales, currency, {
        decimals: 0,
      }),
      share_pct: shareToPct(product.share_of_food_sales),
      share_label: product.in_food_sales
        ? formatPctLabel(shareToPct(product.share_of_food_sales))
        : "—",
      is_combo: product.is_combo,
      components: product.components.map((part) => ({
        odoo_product_id: part.odoo_product_id,
        odoo_name: part.odoo_name,
        net_sales_label: formatMoneyEs(part.net_sales, currency, {
          decimals: 0,
        }),
      })),
      classification: product.classification,
      classification_label: product.classification_label,
      treatment: product.treatment,
      treatment_label: treatmentText(product.treatment).label,
      in_food_sales: product.in_food_sales,
      suggested_treatment: product.suggested_treatment?.treatment ?? null,
      suggested_treatment_reason: product.suggested_treatment?.reason ?? null,
      link_state: product.link_state,
      link_state_label: product.link_state_label,
      display_state_label: displayStateText(display.label, lang),
      display_state_tone: display.tone,
      menu_item_id: recipeId,
      recipe_name: recipeName ?? null,
      evidence_label: bound
        ? evidenceSentence(evidence)
        : product.link_state === "sugerido"
          ? w.suggestionNoIngredients
          : evidenceSentence(evidence),
      evidence_checks: evidenceChecklist({
        odoo_name: product.odoo_name,
        block_name: evidence.block_name ?? recipeName ?? null,
        evidence,
        pos_price: posPrice,
        currency,
      }),
      confirmed: product.link_state === "confirmado",
      can_undo: product.link_state === "confirmado",
      action_label: vincularActionLabel({
        lang,
        confirmed: product.link_state === "confirmado",
        is_combo: product.is_combo,
        classification: product.treatment,
        link_state: product.link_state,
        recipe_name: recipeName ?? null,
        ambiguous,
        can_confirm: canConfirm,
      }),
      can_confirm_suggestion:
        bound && canConfirm && product.link_state === "sugerido",
      suggestion_bound: bound,
      evidence,
      preview_lines: evidence.lines.map((line) =>
        toReviewLine(line, currency, evidence.milton_cost)
      ),
      milton_cost_label:
        evidence.milton_cost != null
          ? formatMoneyEs(evidence.milton_cost, currency)
          : null,
      excel_total_label:
        evidence.excel_total != null
          ? formatMoneyEs(evidence.excel_total, currency)
          : null,
      confidence_label:
        evidence.confidence != null
          ? formatPctLabel(shareToPct(evidence.confidence))
          : null,
      source_label: sourceLabel,
      share_hint: null,
    };
  });

  for (const row of products) {
    if (!row.menu_item_id) continue;
    const sibling = products.find(
      (other) =>
        other.odoo_product_id !== row.odoo_product_id &&
        namesAlmostEqual(other.odoo_name, row.odoo_name)
    );
    if (sibling) {
      row.share_hint = fmt(w.shareHint, {
        name: sibling.odoo_name,
        id: sibling.odoo_product_id,
      });
    }
  }

  const todos: TodoRow[] = [];
  const reviewItems: ReviewItemView[] = [];
  let needRecipe = 0;
  let linked = 0;
  let approvedDishes = 0;

  for (const product of input.products) {
    const versions = product.menu_item_id
      ? (versionsByMenu.get(product.menu_item_id) ?? [])
      : [];
    const approved = hasApprovedVersion(versions);
    const link = linkByProduct.get(product.odoo_product_id);
    const evidence = parseSuggestionEvidence(link?.evidence);
    if (product.link_state === "confirmado") linked += 1;
    if (approved && product.link_state === "confirmado") approvedDishes += 1;

    const kind = classifyTodoKind({ product, evidence, approved });
    if (kind) {
      todos.push({
        rank: todos.length + 1,
        odoo_product_id: product.odoo_product_id,
        odoo_name: product.odoo_name,
        kind,
        kind_label: todoKindLabel(kind, lang),
        action_label: todoKindAction(kind, lang),
        reason: productReason({
          kind,
          evidence,
          odoo_name: product.odoo_name,
          is_combo: product.is_combo,
          has_components: product.components.length > 0,
          excluded_parts: product.excluded_parts,
          currency,
        }),
        share_pct: shareToPct(product.share_of_food_sales),
        share_label: formatPctLabel(shareToPct(product.share_of_food_sales)),
        view: "plato",
      });
    }

    if (!approved && product.menu_item_id && isUncertainEvidence(evidence)) {
      const latest = versions
        .filter((row) => row.status === "in_review")
        .sort((a, b) => b.version_number - a.version_number)[0];
      reviewItems.push({
        odoo_product_id: product.odoo_product_id,
        odoo_name: product.odoo_name,
        menu_item_id: product.menu_item_id,
        recipe_version_id: evidence.recipe_version_id ?? latest?.id ?? null,
        tab: evidence.tab ?? w.noTab,
        block_name: evidence.block_name,
        filename: evidence.filename,
        pending: evidence.pending,
        excel_match: evidence.excel_match,
        reason: productReason({
          kind: "por_revisar",
          evidence,
          odoo_name: product.odoo_name,
          is_combo: product.is_combo,
          has_components: product.components.length > 0,
          excluded_parts: product.excluded_parts,
          currency,
        }),
        milton_cost_label:
          evidence.milton_cost != null
            ? formatMoneyEs(evidence.milton_cost, currency)
            : null,
        excel_total_label:
          evidence.excel_total != null
            ? formatMoneyEs(evidence.excel_total, currency)
            : null,
        lines: evidence.lines.map((line) =>
          toReviewLine(line, currency, evidence.milton_cost)
        ),
      });
    }
  }

  // Products whose treatment needs a recipe (combos go by their parts).
  const needsRecipe = (product: RankedPosProduct) =>
    !product.is_combo && TREATMENT_RULES[product.treatment].needs_recipe;
  needRecipe = input.products.filter(needsRecipe).length;
  linked = input.products.filter(
    (product) => needsRecipe(product) && product.link_state === "confirmado"
  ).length;
  const suggestedLinks = input.products.filter(
    (product) => needsRecipe(product) && product.link_state === "sugerido"
  ).length;
  const unresolved = input.products.filter(
    (product) => needsRecipe(product) && product.link_state !== "confirmado"
  ).length;
  const toClassify = input.products.filter(
    (product) =>
      product.classification === "por_clasificar" && !product.is_combo
  );

  todos.sort(
    (a, b) =>
      b.share_pct - a.share_pct || a.odoo_name.localeCompare(b.odoo_name, "es")
  );
  todos.forEach((row, index) => {
    row.rank = index + 1;
  });

  const slices = coverageSlices(input.products, lang);
  // "Continuar": the next dish to do in Plato por plato (sales order).
  const nextPlato =
    buildPlatoQueue(products, versionsByMenu, lang).find(
      (row) => row.status !== "listo"
    ) ?? null;
  const excelUploaded =
    Boolean(input.latestUpload) ||
    input.batches.length > 0 ||
    input.versions.some((v) => v.source_type === "import");
  const platoQueue = withDishStatus(
    buildPlatoQueue(products, versionsByMenu, lang),
    input.dishEconomics ?? null
  );
  const platoSelectedId =
    input.view === "plato" && input.selectedOdooProductId == null
      ? (platoQueue.find((row) => row.status !== "listo")?.odoo_product_id ??
        platoQueue[0]?.odoo_product_id ??
        null)
      : (input.selectedOdooProductId ?? null);
  const selected =
    products.find((row) => row.odoo_product_id === platoSelectedId) ?? null;

  const reviewOrder = reviewItems.map((item) => item.odoo_product_id);
  let editor = selected
    ? buildEditorView({
        product: selected,
        versions: selected.menu_item_id
          ? (versionsByMenu.get(selected.menu_item_id) ?? [])
          : [],
        currency,
        lang,
      })
    : null;
  if (editor && input.view === "plato") {
    // Next dish still to do, in sales order after this one (wrapping).
    const order = platoQueue.map((row) => row.odoo_product_id);
    const idx = order.indexOf(editor.odoo_product_id);
    const after = [
      ...platoQueue.slice(idx + 1),
      ...platoQueue.slice(0, idx + 1),
    ];
    const next = after.find(
      (row) =>
        row.status !== "listo" &&
        row.odoo_product_id !== editor!.odoo_product_id
    );
    editor = {
      ...editor,
      review_index: idx >= 0 ? idx + 1 : null,
      review_total: platoQueue.length,
      next_odoo_product_id: next?.odoo_product_id ?? null,
    };
  } else if (editor) {
    const idx = reviewOrder.indexOf(editor.odoo_product_id);
    editor = {
      ...editor,
      review_index: idx >= 0 ? idx + 1 : null,
      review_total: reviewOrder.length,
      next_odoo_product_id:
        idx >= 0 ? (reviewOrder[idx + 1] ?? reviewOrder[0] ?? null) : null,
    };
  }

  const menuCosteado =
    unresolved === 0 && reviewItems.length === 0 && input.products.length > 0;
  const view: RecipeCostingView =
    menuCosteado && input.view === "resumen" ? "menu-costeado" : input.view;

  const allNet = input.products.reduce((sum, p) => sum + p.net_sales, 0);
  const classificationRows: ClassificationRow[] = (
    ["por_clasificar", ...PICKABLE_TREATMENTS] as PosProductClassification[]
  ).map((id) => {
    const rows = input.products.filter((p) => p.treatment === id);
    const net = rows.reduce((sum, p) => sum + p.net_sales, 0);
    const share =
      id === "excluido"
        ? allNet > 0
          ? (net / allNet) * 100
          : 0
        : rows.reduce((sum, p) => sum + shareToPct(p.share_of_food_sales), 0);
    return {
      id,
      label: treatmentText(id).label,
      count: rows.length,
      hint: treatmentText(id).hint,
      share_label: fmt(
        id === "excluido" ? w.shareOfAllSales : w.shareOfFoodSales,
        { pct: formatPctLabel(round1(share)) }
      ),
    };
  });
  const classifyQueue: ClassifyQueueRow[] = toClassify.map((product) => {
    const suggestion = product.suggested_treatment ?? {
      treatment: "plato_preparado" as const,
      reason: w.soldAsDish,
    };
    return {
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      share_label: formatPctLabel(shareToPct(product.share_of_food_sales)),
      net_sales_label: formatMoneyEs(product.net_sales, currency, {
        decimals: 0,
      }),
      suggested: suggestion.treatment,
      suggested_label: treatmentText(suggestion.treatment).label,
      reason: suggestion.reason,
    };
  });
  const excludedNet = input.excludedNetSales ?? 0;
  const permissionActor = toPermissionActor(input.actor);

  return {
    company_id: input.companyId,
    company_name: input.companyName,
    currency,
    period_label: input.periodLabel,
    view,
    actor: {
      user_id: input.actor.user_id,
      role: input.actor.role,
      is_milton_staff: input.actor.is_milton_staff,
      can_approve: can(permissionActor, "recipes.approve"),
      can_submit: can(permissionActor, "recipes.submit"),
      needs_client_confirmation: actorNeedsClientConfirmation(input.actor),
      // The same can() answers, sent whole so the screens never re-derive a
      // role rule of their own.
      capabilities: capabilityFlags(permissionActor),
    },
    coverage: {
      coverage_pct: input.coveragePct,
      coverage_label: formatPctLabel(input.coveragePct),
      net_sales: input.netSales,
      covered_net_sales: input.coveredNetSales,
      net_sales_label: formatMoneyEs(input.netSales, currency, { decimals: 0 }),
      covered_label: formatMoneyEs(input.coveredNetSales, currency, {
        decimals: 0,
      }),
      excluded_note:
        excludedNet > 0
          ? fmt(w.excludedNote, {
              amount: formatMoneyEs(excludedNet, currency, { decimals: 0 }),
            })
          : null,
      dishes_approved: approvedDishes,
      dishes_need_recipe: needRecipe,
      slices,
      margins_note: fmt(w.marginsNote, {
        pct: formatPctLabel(input.coveragePct),
      }),
      goal_pct: COVERAGE_GOAL_PCT,
      goal_reached: input.coveragePct >= COVERAGE_GOAL_PCT,
      goal_note:
        input.coveragePct >= COVERAGE_GOAL_PCT
          ? w.goalReached
          : fmt(w.goalNote, { goal: COVERAGE_GOAL_PCT }),
    },
    upload_draft_pending: input.uploadDraftPending ?? false,
    item_groups: input.dishEconomics?.item_groups ?? null,
    restaurants: input.restaurants ?? [],
    view_location_id: input.viewLocationId ?? null,
    menu_dishes:
      input.view === "plato" && input.dishEconomics
        ? {
            dishes: input.dishEconomics.menu_dishes,
            excluded: input.dishEconomics.excluded_menu_dishes,
            kpis: menuDishKpis(input.dishEconomics),
            variant_count: input.dishEconomics.menu_totals.variant_count,
            excluded_variant_count:
              input.dishEconomics.menu_totals.excluded_variant_count,
            stored: input.dishEconomics.menu_dishes_stored === true,
            unsaved_variant_count:
              input.dishEconomics.menu_unsaved_variant_count ?? 0,
          }
        : null,
    dish_summaries:
      input.view === "plato" && input.dishEconomics
        ? input.dishEconomics.dishes.map(withoutLines)
        : null,
    selected_dish: selectedDishOf(
      input.dishEconomics ?? null,
      input.selectedOdooProductId ?? null
    ),
    menu_summary:
      input.view === "resumen" && input.dishEconomics
        ? buildMenuSummary(input.dishEconomics, { excelUploaded })
        : null,
    setup_checklist: [
      {
        id: "pos",
        label: w.setupPos,
        detail:
          input.products.length > 0
            ? fmt(w.setupPosDetail, { n: input.products.length })
            : w.setupPosNone,
        done: input.products.length > 0,
      },
      {
        id: "excel",
        label: w.setupExcel,
        // Any live upload or import counts (a price list without recipe
        // blocks, or recipes imported from the file), not only the newest
        // batch with recipe blocks.
        detail: excelUploaded
          ? (input.latestUpload?.filename ?? w.setupExcelImported)
          : w.setupExcelUpload,
        done: excelUploaded,
      },
      {
        id: "platos",
        label: w.setupDishes,
        detail: fmt(w.setupDishesDetail, {
          linked,
          need: needRecipe,
          suggested: suggestedLinks,
          approved: approvedDishes,
        }),
        done: needRecipe > 0 && unresolved === 0,
      },
    ],
    next_dish: nextPlato
      ? {
          odoo_product_id: nextPlato.odoo_product_id,
          odoo_name: nextPlato.odoo_name,
          view: "plato",
          label: fmt(w.continueWith, { name: nextPlato.odoo_name }),
        }
      : null,
    last_progress: input.lastProgress ?? null,
    todos: todos.slice(0, 8),
    todos_total: todos.length,
    classification: classificationRows,
    classify_queue: classifyQueue,
    plato_queue: platoQueue,
    plato_progress: platoProgress(platoQueue, lang),
    treatment_options: PICKABLE_TREATMENTS.map((id) => ({
      id,
      label: treatmentText(id).label,
      hint: treatmentText(id).hint,
    })),
    who_approves: whoApprovesNoteBase(input.companyName, lang),
    products,
    menu_items: [...input.menuItems].sort((a, b) =>
      a.name.localeCompare(b.name, localeFor(lang))
    ),
    batches: input.batches.filter((batch) => batch.can_undo),
    selected,
    editor,
    footer: costingFooter(view, lang),
    combo_sync_hint: input.comboSyncHint ?? null,
    latest_upload: input.latestUpload ?? null,
    reset: input.reset ?? null,
    costeado_stats: {
      approved_prepared: approvedDishes,
      excluded: input.products.filter(
        (p) => !TREATMENT_RULES[p.treatment].needs_recipe
      ).length,
      pending: todos.length,
      excel_matched: products.filter(
        (row) =>
          row.confirmed && row.evidence.excel_match === "match" && !row.is_combo
      ).length,
      excel_total: approvedDishes,
    },
    timings: input.timings,
  };
}

function vincularActionLabel(input: {
  lang: PreferredLanguage;
  confirmed: boolean;
  is_combo: boolean;
  classification: string;
  link_state: string;
  recipe_name: string | null;
  ambiguous: boolean;
  can_confirm: boolean;
}): string {
  const lang = input.lang;
  const w = getDictionary(lang).menu.workspace.view;
  const kinds = (kind: TodoKind) => todoKindAction(kind, lang);
  if (input.confirmed) return w.actionChange;
  if (input.is_combo) return kinds("combo");
  if (
    !TREATMENT_RULES[input.classification as PosProductClassification]
      ?.needs_recipe
  )
    return w.actionChange;
  if (input.classification === "reventa" && !input.recipe_name)
    return kinds("reventa");
  if (input.ambiguous) return kinds("ambiguo");
  if (input.link_state === "sugerido" && input.can_confirm)
    return kinds("sugerido");
  if (!input.recipe_name) return kinds("sin_receta");
  return kinds("ambiguo");
}

function buildEditorView(input: {
  product: VincularProductRow;
  versions: readonly WorkspaceVersion[];
  currency: string;
  lang: PreferredLanguage;
}): RecipeEditorView {
  const w = getDictionary(input.lang).menu.workspace.view;
  // Approved in force, else the newest of any status (dish-version.ts).
  const latest = pickDishVersions(input.versions).version ?? undefined;
  const notes = latest?.notes?.trim();
  const versionLabel = latest
    ? `${notes || (latest.status === "approved" ? w.versionApproved : w.versionDraft)} · v${latest.version_number}`
    : w.versionNone;
  return editorFromEvidence({
    product: input.product,
    recipe_version_id: latest?.id ?? input.product.evidence.recipe_version_id,
    version_label: versionLabel,
    recipe_status: recipeStatusOf(latest),
    currency: input.currency,
    lang: input.lang,
  });
}

function editorFromEvidence(input: {
  product: VincularProductRow;
  recipe_version_id: string | null;
  version_label: string;
  recipe_status: RecipeEditorView["recipe_status"];
  currency: string;
  lang: PreferredLanguage;
}): RecipeEditorView {
  const ev = input.product.evidence;
  const lang = input.lang;
  const dict = getDictionary(lang).menu.workspace;
  const w = dict.view;
  const formatMoneyEs = (amount: number, cur?: string) =>
    formatMoneyEsBase(amount, cur, undefined, lang);
  const milton =
    ev.milton_cost != null
      ? formatMoneyEs(ev.milton_cost, input.currency)
      : null;
  const excel =
    ev.excel_total != null
      ? formatMoneyEs(ev.excel_total, input.currency)
      : null;
  let varianceNote: string | null = null;
  if (ev.excel_match === "mismatch" && milton && excel) {
    const delta =
      ev.variance_amount != null
        ? formatMoneyEs(ev.variance_amount, input.currency)
        : null;
    varianceNote = delta
      ? fmt(w.varianceNoteDelta, { milton, excel, delta })
      : fmt(w.varianceNote, { milton, excel });
    if (ev.reasons[0]) varianceNote = `${varianceNote} ${ev.reasons[0]}`;
  }
  const firstRow = ev.lines.find((line) => line.source_row != null)?.source_row;
  const portionCost =
    ev.milton_cost ??
    (ev.lines.every((line) => !line.pending && line.unit_cost != null)
      ? ev.lines.reduce(
          (sum, line) => sum + line.qty * (line.unit_cost ?? 0),
          0
        )
      : null);
  const yieldNote =
    ev.yield.value != null
      ? ev.yield.source === "assumed"
        ? fmt(w.yieldToConfirm, {
            value: `${ev.yield.value}${ev.yield.unit ? ` ${ev.yield.unit}` : ""}`,
          })
        : fmt(w.yieldIs, {
            value: `${ev.yield.value}${ev.yield.unit ? ` ${ev.yield.unit}` : ""}`,
          })
      : null;
  return {
    odoo_product_id: input.product.odoo_product_id,
    odoo_name: input.product.odoo_name,
    menu_item_id: input.product.menu_item_id,
    recipe_version_id: input.recipe_version_id,
    version_label: input.version_label,
    link_state: input.product.link_state,
    recipe_status: input.recipe_status,
    excel_match: ev.excel_match,
    category: input.product.category,
    pos_price_label: input.product.pos_price_label,
    units_label: input.product.units_label,
    share_label: fmt(w.shareOfSales, { share: input.product.share_label }),
    margin_label:
      input.product.pos_price != null &&
      input.product.pos_price > 0 &&
      ev.milton_cost != null
        ? formatPctLabel(
            ((input.product.pos_price - ev.milton_cost) /
              input.product.pos_price) *
              100
          )
        : null,
    margin_hint: ev.yield.source === "assumed" ? w.marginHint : null,
    excel_row_label:
      ev.filename && ev.tab && firstRow != null
        ? fmt(w.excelRowFull, {
            file: ev.filename,
            tab: ev.tab,
            row: String(firstRow),
          })
        : ev.tab && firstRow != null
          ? fmt(w.excelRowTab, { tab: ev.tab, row: String(firstRow) })
          : ev.tab
            ? fmt(dict.copy.evidence.sheet, { tab: ev.tab })
            : ev.filename,
    menu_source: ev.menu
      ? {
          dish: ev.menu.variant
            ? `${ev.menu.dish} (${ev.menu.variant})`
            : ev.menu.dish,
          description: ev.menu.description,
          price_label:
            ev.menu.price != null
              ? formatMoneyEs(ev.menu.price, input.currency)
              : null,
        }
      : null,
    milton_cost_label: milton,
    excel_total_label: excel,
    variance_note: varianceNote,
    checklist: buildApprovalChecklistBase({
      lang,
      link_state: input.product.link_state,
      evidence: ev,
      odoo_name: input.product.odoo_name,
      odoo_product_id: input.product.odoo_product_id,
    }),
    lines: ev.lines.map((line) =>
      toReviewLineBase(line, input.currency, portionCost, lang)
    ),
    yield_value: ev.yield.value,
    yield_unit: ev.yield.unit,
    yield_assumed: ev.yield.source === "assumed",
    yield_note: yieldNote,
    // NEVER from the stored evidence (a snapshot from import time that can
    // disagree with the header): the editor's footer is the live total of its
    // own lines, or «Sin precio · n líneas pendientes».
    portion_cost_label: null,
    review_index: null,
    review_total: 0,
    next_odoo_product_id: null,
  };
}

/** approved → aprobada; "Lista para aprobar" → por_aprobar; else borrador. */
function recipeStatusOf(
  latest: WorkspaceVersion | undefined
): RecipeEditorView["recipe_status"] {
  if (!latest) return "sin_receta";
  if (latest.status === "approved") return "aprobada";
  return latest.notes?.trim() === "Lista para aprobar"
    ? "por_aprobar"
    : "borrador";
}

function platoStatus(
  lang: PreferredLanguage
): Record<PlatoStatus, { label: string; tone: ChipTone }> {
  const w = getDictionary(lang).menu.workspace.view;
  return {
    listo: { label: w.platoListo, tone: "ok" },
    por_aprobar: { label: w.platoPorAprobar, tone: "sug" },
    borrador: { label: w.platoBorrador, tone: "warn" },
    sin_receta: { label: w.platoSinReceta, tone: "grey" },
  };
}

/** The Spanish text of a treatment, in the person's language. */
function treatmentTexts(
  id: PosProductClassification,
  lang: PreferredLanguage
): { label: string; hint: string } {
  const t = getDictionary(lang).menu.workspace.treatment;
  switch (id) {
    case "plato_preparado":
      return t.platoPreparado;
    case "reventa":
      return t.reventa;
    case "modificador_con_costo":
      return t.modificadorConCosto;
    case "modificador_sin_costo":
      return t.modificadorSinCosto;
    case "combo":
      return t.combo;
    case "excluido":
      return t.excluido;
    default:
      return t.porClasificar;
  }
}

/** Dishes that take a recipe (not combos, not no-cost or excluded),
 *  in the product list's order: top sellers first. */
/** A dish's numbers without its lines (the editor loads those). */
export type DishSummary = Omit<DishEconomics, "lines">;

function withoutLines(dish: DishEconomics): DishSummary {
  const { lines: _lines, ...rest } = dish;
  return rest;
}

function selectedDishOf(
  economics: Pick<DishEconomicsResult, "dishes"> | null,
  odooProductId: number | null
): DishSummary | null {
  if (!economics || odooProductId == null) return null;
  const dish = economics.dishes.find(
    (d) => d.odoo_product_id === odooProductId
  );
  return dish ? withoutLines(dish) : null;
}

const DISH_TONE: Record<DishStatus, ChipTone> = {
  aprobado: "ok",
  estimado: "pur",
  falta_precio: "warn",
  borrador: "grey",
  sin_receta: "grey",
};

/**
 * The chip on each queue row is the shared loader's status. An approved
 * dish shows its food cost % (wireframe: "35%"); a missing price is
 * "Falta precio", never $0.
 */
export function withDishStatus(
  queue: PlatoQueueRow[],
  economics: Pick<DishEconomicsResult, "dishes"> | null
): PlatoQueueRow[] {
  if (!economics) return queue;
  const byId = new Map(economics.dishes.map((d) => [d.odoo_product_id, d]));
  return queue.map((row) => {
    const dish = byId.get(row.odoo_product_id);
    if (!dish) return row;
    const pct =
      dish.status === "aprobado" && dish.food_cost_pct !== null
        ? `${Math.round(dish.food_cost_pct)}%`
        : null;
    return {
      ...row,
      dish_status: dish.status,
      status_label: pct ?? dish.status_label,
      status_note:
        dish.status === "borrador" && dish.state_reason === "desde_el_menu"
          ? FROM_MENU_LABEL
          : undefined,
      status_tone: DISH_TONE[dish.status],
    };
  });
}

export function buildPlatoQueue(
  products: readonly VincularProductRow[],
  versionsByMenu: ReadonlyMap<string, readonly WorkspaceVersion[]>,
  lang: PreferredLanguage = RESTAURANT_COCKPIT_DEFAULT_LANGUAGE
): PlatoQueueRow[] {
  const statuses = platoStatus(lang);
  return products
    .filter(
      (row) => !row.is_combo && TREATMENT_RULES[row.treatment].needs_recipe
    )
    .map((row) => {
      const versions = row.menu_item_id
        ? (versionsByMenu.get(row.menu_item_id) ?? [])
        : [];
      const latest = versions
        .slice()
        .sort((a, b) => b.version_number - a.version_number)[0];
      const recipe = recipeStatusOf(latest);
      const approvedAny = hasApprovedVersion([...versions]);
      const status: PlatoStatus =
        approvedAny && row.confirmed
          ? "listo"
          : recipe === "sin_receta" || !row.menu_item_id
            ? "sin_receta"
            : recipe === "por_aprobar"
              ? "por_aprobar"
              : "borrador";
      return {
        odoo_product_id: row.odoo_product_id,
        odoo_name: row.odoo_name,
        share_label: row.share_label,
        status,
        status_label: statuses[status].label,
        status_tone: statuses[status].tone,
      };
    });
}

function platoProgress(
  queue: readonly PlatoQueueRow[],
  lang: PreferredLanguage
) {
  const done = queue.filter((row) => row.status === "listo").length;
  return {
    done,
    total: queue.length,
    label: fmt(getDictionary(lang).menu.workspace.view.progress, {
      done,
      total: queue.length,
    }),
  };
}
