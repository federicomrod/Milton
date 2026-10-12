import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import {
  CLASSIFICATION_LABELS,
  LINK_STATE_LABELS,
} from "@/lib/restaurant/pos-product-links";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { hasApprovedVersion } from "@/lib/restaurant/recipe-versions";
import type { RecipeVersionRecord } from "@/lib/restaurant/recipe-versions";
import {
  canConfirmSuggestedLink,
  isBoundSuggestion,
  parseSuggestionEvidence,
  type SuggestionEvidenceView,
} from "./evidence";
import {
  displayStateForProduct,
  evidenceChecklist,
  formatUnitsLabel,
  namesAlmostEqual,
  posPriceFromSales,
  productKindLabel,
  type ChipTone,
  type EvidenceCheckItem,
  type ProductKindLabel,
} from "./display";
import {
  formatMoneyEs,
  formatPctLabel,
  lineCostDisplay,
  round1,
  shareToPct,
} from "./format";
import {
  COSTING_FOOTERS,
  TODO_KIND_ACTIONS,
  TODO_KIND_LABELS,
  evidenceSentence,
  isAmbiguousEvidence,
  productReason,
  whoApprovesNote,
  type TodoKind,
} from "./copy";
import { buildApprovalChecklist, type ApprovalChecklist } from "./approval";
import {
  groupUncertainByTab,
  isUncertainEvidence,
  toReviewLine,
  type ReviewItemView,
  type ReviewTabView,
} from "./review";

export type RecipeCostingView =
  | "resumen"
  | "vincular"
  | "validar"
  | "menu-costeado";

export type VincularFilter =
  | "todos"
  | "por_resolver"
  | "confirmados"
  | "combos_otros";

export interface CoverageSlice {
  id: "aprobado" | "por_revisar" | "sin_vincular" | "no_requiere";
  label: string;
  pct: number;
  color: string;
}

export interface StepperStep {
  id: 1 | 2 | 3 | 4;
  title: string;
  detail: string;
  state: "done" | "cur" | "todo";
}

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
  id: string;
  label: string;
  count: number;
  hint: string;
}

export interface VincularProductRow {
  odoo_product_id: number;
  odoo_name: string;
  kind_label: ProductKindLabel;
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
  filter_bucket: VincularFilter | "todos";
  action_label: string;
  can_confirm_suggestion: boolean;
  suggestion_bound: boolean;
  evidence: SuggestionEvidenceView;
  preview_lines: ReturnType<typeof toReviewLine>[];
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
}

export interface RecipeCostingWorkspace {
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
  };
  coverage: {
    coverage_pct: number;
    coverage_label: string;
    net_sales: number;
    covered_net_sales: number;
    net_sales_label: string;
    covered_label: string;
    dishes_approved: number;
    dishes_need_recipe: number;
    slices: CoverageSlice[];
    margins_note: string;
  };
  stepper: StepperStep[];
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
  who_approves: string;
  products: VincularProductRow[];
  filter_counts: Record<VincularFilter, number>;
  review_tabs: ReviewTabView[];
  menu_items: Array<{ id: string; name: string }>;
  batches: SuggestionBatchRow[];
  selected: VincularProductRow | null;
  editor: RecipeEditorView | null;
  menu_costeado: boolean;
  footer: string;
  combo_sync_hint: string | null;
  latest_upload: {
    id: string;
    filename: string;
    created_at: string | null;
    has_candidate_blocks: boolean;
  } | null;
  costeado_stats: {
    approved_prepared: number;
    excluded: number;
    pending: number;
    excel_matched: number;
    excel_total: number;
  };
  timings?: {
    load_ms: number;
    path: "full" | "validar";
  };
}

export interface RecipeEditorView {
  odoo_product_id: number;
  odoo_name: string;
  menu_item_id: string | null;
  recipe_version_id: string | null;
  version_label: string;
  category: string | null;
  pos_price_label: string | null;
  units_label: string | null;
  share_label: string;
  margin_label: string | null;
  margin_hint: string | null;
  excel_row_label: string | null;
  milton_cost_label: string | null;
  excel_total_label: string | null;
  variance_note: string | null;
  checklist: ApprovalChecklist;
  lines: ReturnType<typeof toReviewLine>[];
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
    classification: link.classification,
    classification_label: CLASSIFICATION_LABELS[link.classification],
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
      classification: "por_clasificar",
      classification_label: CLASSIFICATION_LABELS.por_clasificar,
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
  if (input.product.classification === "no_requiere_costeo") return null;
  if (input.product.classification === "componente") return null;
  if (input.product.is_combo) {
    return input.product.components.length === 0 ? "combo" : null;
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
    return isBoundSuggestion(input.evidence) ? "sugerido" : "sin_receta";
  }
  if (input.product.link_state === "sin_vincular") {
    return isBoundSuggestion(input.evidence) ? "sugerido" : "sin_receta";
  }
  return "por_revisar";
}

export function matchesVincularFilter(
  row: VincularProductRow,
  filter: VincularFilter
): boolean {
  if (filter === "todos") return true;
  if (filter === "confirmados") return row.confirmed;
  if (filter === "combos_otros") {
    return (
      row.is_combo ||
      row.classification === "no_requiere_costeo" ||
      row.classification === "componente"
    );
  }
  return !row.confirmed && row.classification !== "no_requiere_costeo";
}

function coverageSlices(
  products: readonly RankedPosProduct[]
): CoverageSlice[] {
  const total = products.reduce((sum, row) => sum + row.net_sales, 0);
  const bucket = {
    aprobado: 0,
    por_revisar: 0,
    sin_vincular: 0,
    no_requiere: 0,
  };
  for (const product of products) {
    if (product.classification === "no_requiere_costeo") {
      bucket.no_requiere += product.net_sales;
    } else if (product.counts_toward_coverage) {
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
      label: "Aprobado",
      pct: pct(bucket.aprobado),
      color: "#1f9d55",
    },
    {
      id: "por_revisar",
      label: "Por revisar",
      pct: pct(bucket.por_revisar),
      color: "#f5a524",
    },
    {
      id: "sin_vincular",
      label: "Sin vincular",
      pct: pct(bucket.sin_vincular),
      color: "#93a6e8",
    },
    {
      id: "no_requiere",
      label: "No requiere costeo",
      pct: pct(bucket.no_requiere),
      color: "#eef0f4",
    },
  ];
}

function stepperFromCounts(input: {
  productCount: number;
  needRecipe: number;
  linked: number;
  unresolved: number;
  toReview: number;
  approved: number;
}): StepperStep[] {
  const steps: Array<Omit<StepperStep, "state">> = [
    {
      id: 1,
      title: "1 · Menú del POS",
      detail: `${input.productCount} productos de Odoo · ${input.needRecipe} requieren receta`,
    },
    {
      id: 2,
      title: "2 · Vincular recetas",
      detail: `${input.linked} de ${input.needRecipe} vinculados · ${input.unresolved} por resolver`,
    },
    {
      id: 3,
      title: "3 · Validar costos",
      detail: `${input.toReview} recetas por revisar`,
    },
    {
      id: 4,
      title: "4 · Aprobar",
      detail: `${input.approved} aprobadas · cuentan en márgenes`,
    },
  ];
  let current: 1 | 2 | 3 | 4 = 1;
  if (input.productCount === 0) current = 1;
  else if (input.unresolved > 0) current = 2;
  else if (input.toReview > 0) current = 3;
  else current = 4;
  const allDone =
    input.productCount > 0 && input.unresolved === 0 && input.toReview === 0;
  return steps.map((step) => ({
    ...step,
    state: allDone
      ? "done"
      : step.id < current
        ? "done"
        : step.id === current
          ? "cur"
          : "todo",
  }));
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
  netSales: number;
  coveredNetSales: number;
  selectedOdooProductId?: number | null;
  lastProgress?: string | null;
  comboSyncHint?: string | null;
  latestUpload?: RecipeCostingWorkspace["latest_upload"];
  timings?: RecipeCostingWorkspace["timings"];
}): RecipeCostingWorkspace {
  const currency = input.currency || "USD";
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
    const bound = isBoundSuggestion(evidence);
    const canConfirm = canConfirmSuggestedLink(evidence);
    const menu = product.menu_item_id
      ? menuById.get(product.menu_item_id)
      : undefined;
    const recipeName = menu?.name ?? evidence.block_name;
    const kind = productKindLabel({
      name: product.odoo_name,
      is_combo: product.is_combo,
      classification: product.classification,
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
      classification: product.classification,
      kind_label: kind,
      ambiguous,
      suggested: product.link_state === "sugerido",
      bound,
      recipe_name: recipeName ?? null,
    });
    const sourceLabel = bound
      ? [
          evidence.tab ? `hoja ${evidence.tab}` : null,
          evidence.lines.some((line) => line.source_row != null)
            ? `fila ${
                evidence.lines.find((line) => line.source_row != null)
                  ?.source_row
              }`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
      : null;
    return {
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      kind_label: kind,
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
      share_pct: shareToPct(product.share_of_net_sales),
      share_label: formatPctLabel(shareToPct(product.share_of_net_sales)),
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
      link_state: product.link_state,
      link_state_label: product.link_state_label,
      display_state_label: display.label,
      display_state_tone: display.tone,
      menu_item_id: product.menu_item_id,
      recipe_name: recipeName ?? null,
      evidence_label: bound
        ? evidenceSentence(evidence)
        : product.link_state === "sugerido"
          ? "La sugerencia no trae ingredientes"
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
      filter_bucket: product.is_combo
        ? "combos_otros"
        : product.link_state === "confirmado"
          ? "confirmados"
          : "por_resolver",
      action_label: vincularActionLabel({
        confirmed: product.link_state === "confirmado",
        is_combo: product.is_combo,
        classification: product.classification,
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
      row.share_hint = `«${sibling.odoo_name}» (#${sibling.odoo_product_id}) puede compartirla solo si lleva lo mismo en la misma cantidad.`;
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
    if (
      product.classification === "requiere_receta" ||
      product.classification === "por_clasificar"
    ) {
      if (!product.is_combo) needRecipe += 1;
    }
    if (product.classification === "requiere_receta") needRecipe += 0;
    if (product.classification !== "no_requiere_costeo" && !product.is_combo) {
      if (product.classification === "por_clasificar") {
        // already counted loosely
      }
    }
    if (product.link_state === "confirmado") linked += 1;
    if (approved && product.link_state === "confirmado") approvedDishes += 1;

    const kind = classifyTodoKind({ product, evidence, approved });
    if (kind) {
      todos.push({
        rank: todos.length + 1,
        odoo_product_id: product.odoo_product_id,
        odoo_name: product.odoo_name,
        kind,
        kind_label: TODO_KIND_LABELS[kind],
        action_label: TODO_KIND_ACTIONS[kind],
        reason: productReason({
          kind,
          evidence,
          odoo_name: product.odoo_name,
          is_combo: product.is_combo,
          has_components: product.components.length > 0,
          currency,
        }),
        share_pct: shareToPct(product.share_of_net_sales),
        share_label: formatPctLabel(shareToPct(product.share_of_net_sales)),
        view:
          kind === "por_revisar" || kind === "falta_precio"
            ? "validar"
            : "vincular",
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
        tab: evidence.tab ?? "Sin pestaña",
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

  // Recount needRecipe cleanly: Odoo products that are not excluded.
  needRecipe = input.products.filter(
    (product) =>
      product.classification !== "no_requiere_costeo" &&
      product.classification !== "componente"
  ).length;
  linked = input.products.filter(
    (product) =>
      product.link_state === "confirmado" &&
      product.classification !== "no_requiere_costeo"
  ).length;
  const unresolved = input.products.filter(
    (product) =>
      product.classification !== "no_requiere_costeo" &&
      product.classification !== "componente" &&
      product.link_state !== "confirmado"
  ).length;

  todos.sort(
    (a, b) =>
      b.share_pct - a.share_pct || a.odoo_name.localeCompare(b.odoo_name, "es")
  );
  todos.forEach((row, index) => {
    row.rank = index + 1;
  });

  const reviewTabs = groupUncertainByTab(reviewItems);
  const slices = coverageSlices(input.products);
  const next = todos[0] ?? null;
  const selected =
    products.find(
      (row) => row.odoo_product_id === input.selectedOdooProductId
    ) ?? null;

  const reviewOrder = reviewItems.map((item) => item.odoo_product_id);
  let editor = selected
    ? buildEditorView({
        product: selected,
        versions: selected.menu_item_id
          ? (versionsByMenu.get(selected.menu_item_id) ?? [])
          : [],
        currency,
      })
    : reviewItems[0]
      ? buildEditorFromReview(
          reviewItems[0],
          products,
          versionsByMenu,
          currency
        )
      : null;
  if (editor) {
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

  const filter_counts: Record<VincularFilter, number> = {
    todos: products.length,
    por_resolver: products.filter((row) =>
      matchesVincularFilter(row, "por_resolver")
    ).length,
    confirmados: products.filter((row) =>
      matchesVincularFilter(row, "confirmados")
    ).length,
    combos_otros: products.filter((row) =>
      matchesVincularFilter(row, "combos_otros")
    ).length,
  };

  const platos = products.filter((p) => p.kind_label === "Plato").length;
  const bebidas = products.filter((p) => p.kind_label === "Bebida");
  const bebidasReventa = bebidas.filter(
    (p) => p.classification === "no_requiere_costeo"
  ).length;
  const bebidasPrep = bebidas.length - bebidasReventa;
  const combos = products.filter((p) => p.is_combo).length;
  const componentes = products.filter(
    (p) => p.kind_label === "Modificador"
  ).length;
  const modificadoresConCosto = products.filter(
    (p) => p.kind_label === "Modificador" && p.classification === "componente"
  ).length;
  const excluidos = products.filter((p) => p.kind_label === "Cargo").length;

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
      can_approve:
        input.actor.role === "owner" ||
        input.actor.role === "admin" ||
        input.actor.is_milton_staff,
      can_submit:
        input.actor.role === "owner" ||
        input.actor.role === "admin" ||
        input.actor.role === "manager" ||
        input.actor.is_milton_staff,
      needs_client_confirmation:
        input.actor.is_milton_staff &&
        input.actor.role !== "owner" &&
        input.actor.role !== "admin",
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
      dishes_approved: approvedDishes,
      dishes_need_recipe: needRecipe,
      slices,
      margins_note: `Los márgenes del Menú y Costos solo usan el ${formatPctLabel(input.coveragePct)} aprobado.`,
    },
    stepper: stepperFromCounts({
      productCount: input.products.length,
      needRecipe,
      linked,
      unresolved,
      toReview: reviewItems.length,
      approved: approvedDishes,
    }),
    next_dish: next
      ? {
          odoo_product_id: next.odoo_product_id,
          odoo_name: next.odoo_name,
          view: next.view,
          label: `Revisar siguiente plato: ${next.odoo_name} →`,
        }
      : null,
    last_progress: input.lastProgress ?? null,
    todos: todos.slice(0, 8),
    todos_total: todos.length,
    classification: [
      {
        id: "platos",
        label: "Platos",
        count: platos,
        hint: "requieren receta",
      },
      {
        id: "bebidas",
        label: "Bebidas",
        count: bebidas.length,
        hint:
          bebidas.length === 0
            ? "de reventa o preparadas"
            : `${bebidasReventa} de reventa · ${bebidasPrep} preparadas`,
      },
      {
        id: "componentes",
        label: "Modificadores",
        count: componentes,
        hint:
          modificadoresConCosto > 0
            ? `${modificadoresConCosto} con costo (ej. extra queso)`
            : "con costo se suman al plato",
      },
      {
        id: "combos",
        label: "Combos",
        count: combos,
        hint:
          combos === 1
            ? "se costea por sus partes"
            : "se costean por sus partes",
      },
      {
        id: "otros",
        label: "Otros (propina, cargos)",
        count: excluidos,
        hint: "no requieren costeo",
      },
    ],
    who_approves: whoApprovesNote(input.companyName),
    products,
    filter_counts,
    review_tabs: reviewTabs,
    menu_items: [...input.menuItems].sort((a, b) =>
      a.name.localeCompare(b.name, "es")
    ),
    batches: input.batches.filter((batch) => batch.can_undo),
    selected,
    editor,
    menu_costeado: menuCosteado,
    footer: COSTING_FOOTERS[view],
    combo_sync_hint: input.comboSyncHint ?? null,
    latest_upload: input.latestUpload ?? null,
    costeado_stats: {
      approved_prepared: approvedDishes,
      excluded: combos + componentes + excluidos + bebidasReventa,
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
  confirmed: boolean;
  is_combo: boolean;
  classification: string;
  link_state: string;
  recipe_name: string | null;
  ambiguous: boolean;
  can_confirm: boolean;
}): string {
  if (input.confirmed) return "Cambiar";
  if (input.is_combo) return "Ver partes";
  if (input.classification === "no_requiere_costeo") return "Cambiar";
  if (input.ambiguous) return "Elegir";
  if (input.link_state === "sugerido" && input.can_confirm) return "Confirmar";
  if (!input.recipe_name) return "Crear receta";
  return "Elegir";
}

function buildEditorView(input: {
  product: VincularProductRow;
  versions: readonly WorkspaceVersion[];
  currency: string;
}): RecipeEditorView {
  const latest = input.versions
    .slice()
    .sort((a, b) => b.version_number - a.version_number)[0];
  const notes = latest?.notes?.trim();
  const versionLabel = latest
    ? `${notes || (latest.status === "approved" ? "Aprobada" : "Borrador")} · v${latest.version_number}`
    : "Sin receta";
  return editorFromEvidence({
    product: input.product,
    recipe_version_id: latest?.id ?? input.product.evidence.recipe_version_id,
    version_label: versionLabel,
    currency: input.currency,
  });
}

function buildEditorFromReview(
  item: ReviewItemView,
  products: readonly VincularProductRow[],
  versionsByMenu: Map<string, WorkspaceVersion[]>,
  currency: string
): RecipeEditorView {
  const product =
    products.find((row) => row.odoo_product_id === item.odoo_product_id) ??
    null;
  if (product) {
    return buildEditorView({
      product,
      versions: product.menu_item_id
        ? (versionsByMenu.get(product.menu_item_id) ?? [])
        : [],
      currency,
    });
  }
  return {
    odoo_product_id: item.odoo_product_id,
    odoo_name: item.odoo_name,
    menu_item_id: item.menu_item_id,
    recipe_version_id: item.recipe_version_id,
    version_label: "Borrador",
    category: null,
    pos_price_label: null,
    units_label: null,
    share_label: "",
    margin_label: null,
    margin_hint: null,
    excel_row_label: item.filename
      ? `${item.filename} › hoja ${item.tab}`
      : item.tab,
    milton_cost_label: item.milton_cost_label,
    excel_total_label: item.excel_total_label,
    variance_note: item.reason,
    checklist: buildApprovalChecklist({
      link_state: null,
      odoo_name: item.odoo_name,
      odoo_product_id: item.odoo_product_id,
      evidence: {
        tab: item.tab,
        block_name: item.block_name,
        confidence: null,
        evidence_text: null,
        source: null,
        yield: { value: null, unit: null, source: null },
        excel_total: null,
        milton_cost: null,
        excel_match: item.excel_match,
        variance_amount: null,
        variance_pct: null,
        status: "borrador",
        pending: item.pending,
        reasons: item.reason ? [item.reason] : [],
        lines: item.lines.map((line) => ({
          source_row: line.source_row,
          raw_name: line.raw_name,
          ingredient_match: null,
          sub_recipe_match: line.is_sub_recipe ? line.raw_name : null,
          qty: line.qty,
          unit: line.unit,
          unit_cost: line.unit_cost,
          flags: line.flags,
          pending: line.pending,
          reasons: line.reasons,
        })),
        recipe_version_id: item.recipe_version_id,
        filename: item.filename,
      },
    }),
    lines: item.lines,
    yield_value: null,
    yield_unit: null,
    yield_assumed: false,
    yield_note: null,
    portion_cost_label: item.milton_cost_label,
    review_index: null,
    review_total: 0,
    next_odoo_product_id: null,
  };
}

function editorFromEvidence(input: {
  product: VincularProductRow;
  recipe_version_id: string | null;
  version_label: string;
  currency: string;
}): RecipeEditorView {
  const ev = input.product.evidence;
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
    varianceNote = `El costo calculado es ${milton}, pero tu Excel dice ${excel}${delta ? ` (${delta})` : ""}.`;
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
        ? `Rendimiento por confirmar: ${ev.yield.value}${ev.yield.unit ? ` ${ev.yield.unit}` : ""}`
        : `Rinde ${ev.yield.value}${ev.yield.unit ? ` ${ev.yield.unit}` : ""}`
      : null;
  return {
    odoo_product_id: input.product.odoo_product_id,
    odoo_name: input.product.odoo_name,
    menu_item_id: input.product.menu_item_id,
    recipe_version_id: input.recipe_version_id,
    version_label: input.version_label,
    category: input.product.category,
    pos_price_label: input.product.pos_price_label,
    units_label: input.product.units_label,
    share_label: `${input.product.share_label} de las ventas`,
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
    margin_hint:
      ev.yield.source === "assumed"
        ? "si confirmas el rendimiento el margen cambia"
        : null,
    excel_row_label:
      ev.filename && ev.tab && firstRow != null
        ? `${ev.filename} › hoja ${ev.tab} › fila ${firstRow}`
        : ev.tab && firstRow != null
          ? `hoja ${ev.tab} › fila ${firstRow}`
          : ev.tab
            ? `hoja ${ev.tab}`
            : ev.filename,
    milton_cost_label: milton,
    excel_total_label: excel,
    variance_note: varianceNote,
    checklist: buildApprovalChecklist({
      link_state: input.product.link_state,
      evidence: ev,
      odoo_name: input.product.odoo_name,
      odoo_product_id: input.product.odoo_product_id,
    }),
    lines: ev.lines.map((line) =>
      toReviewLine(line, input.currency, portionCost)
    ),
    yield_value: ev.yield.value,
    yield_unit: ev.yield.unit,
    yield_assumed: ev.yield.source === "assumed",
    yield_note: yieldNote,
    portion_cost_label:
      portionCost != null ? formatMoneyEs(portionCost, input.currency) : milton,
    review_index: null,
    review_total: 0,
    next_odoo_product_id: null,
  };
}

export function lineCostIsPending(
  label: string,
  amount: number | null
): boolean {
  return label === "Pendiente" || amount == null;
}

void lineCostDisplay;
