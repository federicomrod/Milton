import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { hasApprovedVersion } from "@/lib/restaurant/recipe-versions";
import type { RecipeVersionRecord } from "@/lib/restaurant/recipe-versions";
import {
  parseSuggestionEvidence,
  type SuggestionEvidenceView,
} from "./evidence";
import {
  formatMoneyEs,
  formatPctLabel,
  lineCostDisplay,
  round1,
  shareToPct,
} from "./format";
import {
  TODO_KIND_ACTIONS,
  TODO_KIND_LABELS,
  evidenceSentence,
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
  kind_label: string;
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
  menu_item_id: string | null;
  recipe_name: string | null;
  evidence_label: string;
  confirmed: boolean;
  can_undo: boolean;
  filter_bucket: VincularFilter | "todos";
  evidence: SuggestionEvidenceView;
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
}

export interface RecipeEditorView {
  odoo_product_id: number;
  odoo_name: string;
  menu_item_id: string | null;
  recipe_version_id: string | null;
  version_label: string;
  share_label: string;
  excel_row_label: string | null;
  milton_cost_label: string | null;
  excel_total_label: string | null;
  variance_note: string | null;
  checklist: ApprovalChecklist;
  lines: ReturnType<typeof toReviewLine>[];
  yield_value: number | null;
  yield_unit: string | null;
  yield_assumed: boolean;
}

export interface WorkspaceMenuItem {
  id: string;
  name: string;
}

export interface WorkspaceVersion extends RecipeVersionRecord {
  notes?: string | null;
}

export function classifyTodoKind(input: {
  product: RankedPosProduct;
  evidence: SuggestionEvidenceView;
  approved: boolean;
}): TodoKind | null {
  if (input.approved && input.product.link_state === "confirmado") return null;
  if (input.product.classification === "no_requiere_costeo") return null;
  if (input.product.is_combo && input.product.components.length === 0) {
    return "combo";
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
  if (input.product.link_state === "sugerido") return "sugerido";
  if (input.product.link_state === "sin_vincular") {
    return input.evidence.block_name ? "sugerido" : "sin_receta";
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
}): RecipeCostingWorkspace {
  const currency = input.currency || "USD";
  const versionsByMenu = new Map<string, WorkspaceVersion[]>();
  for (const version of input.versions) {
    const list = versionsByMenu.get(version.menu_item_id) ?? [];
    list.push(version);
    versionsByMenu.set(version.menu_item_id, list);
  }
  const menuName = new Map(input.menuItems.map((row) => [row.id, row.name]));
  const linkByProduct = new Map<number, PosProductLinkRecord>();
  for (const link of input.links) {
    if (link.company_id !== input.companyId) continue;
    linkByProduct.set(link.odoo_product_id, link);
  }

  const products: VincularProductRow[] = input.products.map((product) => {
    const link = linkByProduct.get(product.odoo_product_id);
    const evidence = parseSuggestionEvidence(link?.evidence);
    const recipeName =
      (product.menu_item_id ? menuName.get(product.menu_item_id) : null) ??
      evidence.block_name;
    return {
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      kind_label: product.is_combo ? "Combo" : product.classification_label,
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
      menu_item_id: product.menu_item_id,
      recipe_name: recipeName ?? null,
      evidence_label: evidenceSentence(evidence),
      confirmed: product.link_state === "confirmado",
      can_undo: product.link_state === "confirmado",
      filter_bucket: product.is_combo
        ? "combos_otros"
        : product.link_state === "confirmado"
          ? "confirmados"
          : "por_resolver",
      evidence,
    };
  });

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
        lines: evidence.lines.map((line) => toReviewLine(line, currency)),
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

  const editor = selected
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

  const platos = input.products.filter(
    (p) =>
      !p.is_combo &&
      (p.classification === "requiere_receta" ||
        p.classification === "por_clasificar")
  ).length;
  const combos = input.products.filter((p) => p.is_combo).length;
  const componentes = input.products.filter(
    (p) => p.classification === "componente"
  ).length;
  const excluidos = input.products.filter(
    (p) => p.classification === "no_requiere_costeo"
  ).length;

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
        id: "combos",
        label: "Combos",
        count: combos,
        hint:
          combos === 1
            ? "se costea por sus partes"
            : "se costean por sus partes",
      },
      {
        id: "componentes",
        label: "Modificadores",
        count: componentes,
        hint: "con costo se suman al plato",
      },
      {
        id: "otros",
        label: "Otros",
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
    footer:
      "Base: el POS dice qué se vende; el Excel solo aporta recetas y costos.",
  };
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
    share_label: "",
    excel_row_label: item.filename
      ? `${item.filename} › hoja ${item.tab}`
      : item.tab,
    milton_cost_label: item.milton_cost_label,
    excel_total_label: item.excel_total_label,
    variance_note: item.reason,
    checklist: buildApprovalChecklist({
      link_state: null,
      evidence: {
        tab: item.tab,
        block_name: item.block_name,
        confidence: null,
        evidence_text: null,
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
  return {
    odoo_product_id: input.product.odoo_product_id,
    odoo_name: input.product.odoo_name,
    menu_item_id: input.product.menu_item_id,
    recipe_version_id: input.recipe_version_id,
    version_label: input.version_label,
    share_label: `${input.product.share_label} de las ventas`,
    excel_row_label:
      ev.tab && firstRow != null
        ? `hoja ${ev.tab} › fila ${firstRow}`
        : ev.tab
          ? `hoja ${ev.tab}`
          : null,
    milton_cost_label: milton,
    excel_total_label: excel,
    variance_note: varianceNote,
    checklist: buildApprovalChecklist({
      link_state: input.product.link_state,
      evidence: ev,
    }),
    lines: ev.lines.map((line) => toReviewLine(line, input.currency)),
    yield_value: ev.yield.value,
    yield_unit: ev.yield.unit,
    yield_assumed: ev.yield.source === "assumed",
  };
}

export function lineCostIsPending(
  label: string,
  amount: number | null
): boolean {
  return label === "Pendiente" || amount == null;
}

void lineCostDisplay;
