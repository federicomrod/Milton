import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  loadCompanyMembershipRole,
  loadCompanyName,
} from "@/lib/restaurant/cost-workbook/reset-auth";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { sortBatchesNewestFirst } from "@/lib/restaurant/cost-workbook/history";
import {
  canManageCompanyCostReset,
  multiRestaurantResetWarningEs,
  resetConfirmPromptEs,
} from "@/lib/restaurant/cost-workbook/reset";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import { formatPageDateRangeLabel } from "@/lib/restaurant/page-date-range";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import {
  classificationFromStored,
  isPosProductLinkState,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import {
  groupBatchesByFile,
  buildRecipeCostingWorkspace,
  rankedProductsFromLinks,
  type RecipeCostingView,
  type RecipeCostingWorkspace,
  type WorkspaceVersion,
} from "./workspace";

export const COMBO_SYNC_HINT =
  "Los campos de combo ya existen, pero ninguna venta los trae. Sincroniza el POS de nuevo para que Odoo marque los combos.";

function asLink(row: Record<string, unknown>): PosProductLinkRecord | null {
  const odooProductId = row.odoo_product_id;
  if (typeof odooProductId !== "number" || !Number.isInteger(odooProductId)) {
    return null;
  }
  if (typeof row.company_id !== "string" || typeof row.odoo_name !== "string") {
    return null;
  }
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    company_id: row.company_id,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
    odoo_product_id: odooProductId,
    odoo_name: row.odoo_name,
    classification: classificationFromStored(row.classification),
    menu_item_id:
      typeof row.menu_item_id === "string" ? row.menu_item_id : null,
    link_state: isPosProductLinkState(row.link_state)
      ? row.link_state
      : "sin_vincular",
    confirmed_by:
      typeof row.confirmed_by === "string" ? row.confirmed_by : null,
    confirmed_at:
      typeof row.confirmed_at === "string" ? row.confirmed_at : null,
    confirmed_how:
      typeof row.confirmed_how === "string" ? row.confirmed_how : null,
    evidence:
      row.evidence &&
      typeof row.evidence === "object" &&
      !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : {},
  };
}

export function parseCostingView(value: string | null): RecipeCostingView {
  // Vincular and Validar are one screen now; old links land on it.
  if (value === "plato" || value === "vincular" || value === "validar") {
    return "plato";
  }
  if (value === "preparaciones" || value === "menu-costeado") return value;
  return "resumen";
}

async function probeComboSyncHint(
  supabase: SupabaseClient,
  companyId: string,
  hasCombos: boolean
): Promise<string | null> {
  if (hasCombos) return null;
  const { data, error } = await supabase
    .from("pos_sales_items")
    .select("id")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .not("combo_parent_odoo_product_id", "is", null)
    .limit(1);
  if (error) {
    if (errorMentionsColumn(error, "combo_parent_odoo_product_id")) {
      return null;
    }
    return null;
  }
  if (data && data.length > 0) return null;
  return COMBO_SYNC_HINT;
}

export async function loadRecipeCostingWorkspace(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    userId: string;
    view?: RecipeCostingView;
    locationId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    selectedOdooProductId?: number | null;
    /** Plato por plato after an edit: reload only the open dish, with its
     *  own sales (price, margin) instead of scanning every sale. */
    editorOnly?: boolean;
  }
): Promise<
  { ok: true; workspace: RecipeCostingWorkspace } | { ok: false; error: string }
> {
  const started = Date.now();
  const view = input.view ?? "resumen";
  const editorOnly =
    view === "plato" &&
    input.editorOnly === true &&
    input.selectedOdooProductId != null;

  const [list, roleLoad, companyName, currency, isMiltonStaff] =
    await Promise.all([
      editorOnly
        ? // Only the open dish's own sales: its price, margin and status.
          loadDishEconomics(
            input.companyId,
            input.startDate ?? null,
            input.endDate ?? null,
            input.locationId ?? null,
            input.selectedOdooProductId ?? null
          ).then((res) =>
            res.ok
              ? { ok: true as const, list: res.list, economics: res.result }
              : res
          )
        : // R1-09a: the same loader as Menú, Cockpit and the email, so
          // coverage is one number everywhere.
          loadDishEconomics(
            input.companyId,
            input.startDate ?? null,
            input.endDate ?? null,
            input.locationId ?? null
          ).then((res) =>
            res.ok
              ? { ok: true as const, list: res.list, economics: res.result }
              : res
          ),
      loadCompanyMembershipRole(supabase, input.companyId, input.userId),
      loadCompanyName(supabase, input.companyId),
      resolveCompanyCurrency(supabase, input.companyId),
      isUserAdminServer(input.userId),
    ]);
  if (list && !list.ok) return list;

  const [linksRes, versionsRes, menuRes, history] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("pos_product_links")
        .select(
          "id, company_id, location_id, odoo_product_id, odoo_name, classification, menu_item_id, link_state, confirmed_by, confirmed_at, confirmed_how, evidence"
        )
        .eq("company_id", input.companyId)
    ),
    fetchAllRows<WorkspaceVersion>(() =>
      supabase
        .from("recipe_versions")
        .select(
          "id, recipe_id, menu_item_id, version_number, status, effective_date, source_type, notes"
        )
        .eq("company_id", input.companyId)
    ),
    fetchAllRows<{
      id: string;
      name: string;
      category: string | null;
      selling_price: number | null;
    }>(() =>
      supabase
        .from("menu_items")
        .select("id, name, category, selling_price")
        .eq("company_id", input.companyId)
    ),
    // Live uploads without their snapshots (each holds ~150 KB of recipes).
    createSupabaseCostWorkbookRepo(supabase)
      .listLiveBatchSummaries(input.companyId)
      .catch(() => []),
  ]);
  if (linksRes.error) {
    return { ok: false, error: "No se pudieron leer los vínculos POS." };
  }
  if (versionsRes.error) {
    return { ok: false, error: "No se pudieron leer las versiones de receta." };
  }
  if (menuRes.error) {
    return { ok: false, error: "No se pudieron leer los platillos." };
  }

  const liveHistory = sortBatchesNewestFirst(
    history.filter((row) => !row.undone_at)
  );
  const batches: RecipeCostingWorkspace["batches"] =
    groupBatchesByFile(liveHistory);
  // The upload suggestions will read: the newest live one with recipe
  // blocks, not merely the newest one.
  const source = liveHistory.find((row) => row.has_recipe_blocks) ?? null;
  // "Excel de costos subido": the price list with its recipes, or the
  // recipes imported from the file ("Importar").
  const fileUpload =
    source ?? liveHistory.find((row) => row.is_recipe_import) ?? null;
  const latestLive = fileUpload ?? liveHistory[0] ?? null;
  const latestUpload = latestLive
    ? {
        id: latestLive.id,
        filename: latestLive.filename.replace(/ · recetas$/, ""),
        created_at: latestLive.created_at ?? null,
        has_candidate_blocks: Boolean(fileUpload),
      }
    : null;

  const links = (linksRes.rows ?? [])
    .map(asLink)
    .filter((row): row is PosProductLinkRecord => row !== null);

  const products =
    list && list.ok && list.list.products.length > 0
      ? list.list.products
      : editorOnly
        ? rankedProductsFromLinks(links, input.selectedOdooProductId)
        : [];

  const comboSyncHint = editorOnly
    ? null
    : await probeComboSyncHint(
        supabase,
        input.companyId,
        products.some((product) => product.is_combo)
      );

  const confirmedAt = links
    .map((link) => link.confirmed_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const batchAt = batches[0]?.created_at ?? null;
  const lastAt = [confirmedAt, batchAt].filter(Boolean).sort().at(-1) ?? null;
  const lastProgress = lastAt
    ? `Puedes guardar y seguir después · último avance: ${lastAt.slice(0, 16).replace("T", " ")}`
    : "Puedes guardar y seguir después. El avance queda guardado.";

  // "Empezar de nuevo" lives on Resumen, for the owner or an admin only.
  let reset: RecipeCostingWorkspace["reset"] = null;
  if (view === "resumen" && canManageCompanyCostReset(roleLoad)) {
    const context = await resolveRestaurantContext(
      supabase,
      input.companyId,
      input.locationId ?? null
    );
    const names = context.locations.map((row) => row.name);
    reset = {
      prompt: resetConfirmPromptEs({ companyName, restaurantNames: names }),
      warning:
        names.length > 1
          ? multiRestaurantResetWarningEs(
              names,
              context.locations.find((row) => row.id === input.locationId)
                ?.name ?? names[0]!
            )
          : null,
    };
  }

  // Coverage is the shared loader's number (same as Menú and Cockpit).
  const coverageTotals = list && list.ok ? list.economics.totals : null;

  const periodLabel =
    input.startDate && input.endDate
      ? formatPageDateRangeLabel(
          { from: input.startDate, to: input.endDate },
          "es-MX"
        )
      : null;

  return {
    ok: true,
    workspace: buildRecipeCostingWorkspace({
      companyId: input.companyId,
      companyName,
      currency: currency || "USD",
      periodLabel,
      view,
      actor: {
        user_id: input.userId,
        role: roleLoad.role,
        is_milton_staff: isMiltonStaff,
      },
      products,
      links,
      versions: versionsRes.rows ?? [],
      menuItems: menuRes.rows ?? [],
      batches,
      coveragePct: coverageTotals?.coverage_pct ?? 0,
      netSales: coverageTotals?.food_net_sales ?? 0,
      excludedNetSales: coverageTotals?.excluded_net_sales ?? 0,
      coveredNetSales: coverageTotals?.covered_net_sales ?? 0,
      selectedOdooProductId: input.selectedOdooProductId ?? null,
      lastProgress,
      comboSyncHint,
      latestUpload,
      reset,
      dishEconomics: list && list.ok ? list.economics : null,
      timings: {
        load_ms: Date.now() - started,
        path: editorOnly ? "plato_editor" : "full",
      },
    }),
  };
}
