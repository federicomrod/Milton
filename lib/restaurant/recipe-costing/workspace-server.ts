import type { SupabaseClient } from "@supabase/supabase-js";
import { fmt, getDictionary } from "@/lib/i18n";
import { apiLanguage } from "@/lib/restaurant/api-lang";
import { localeFor, type PreferredLanguage } from "@/lib/restaurant/language";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  loadCompanyMembershipRole,
  loadCompanyName,
} from "@/lib/restaurant/cost-workbook/reset-auth";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import type { CostWorkbookBatchSummary } from "@/lib/restaurant/cost-workbook/types";
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
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import { loadPreparationsOverview } from "./preparations-server";
import type { DishEconomicsLoad } from "@/lib/restaurant/costing/dish-economics-server";
import { ttlCached } from "@/lib/restaurant/ttl-cache";
import { monthLabel, resumenRange } from "@/lib/restaurant/menu-resumen";
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

// R1-09c: these change rarely; one read per minute per company/user
// instead of one per page load and per save.
const cachedRole = ttlCached(
  60_000,
  (_s: SupabaseClient, companyId: string, userId: string) =>
    `${companyId}:${userId}`,
  loadCompanyMembershipRole
);
const cachedCompanyName = ttlCached(
  60_000,
  (_s: SupabaseClient, companyId: string) => companyId,
  loadCompanyName
);
const cachedCurrency = ttlCached(
  60_000,
  (_s: SupabaseClient, companyId: string) => companyId,
  resolveCompanyCurrency
);
const cachedIsAdmin = ttlCached(
  60_000,
  (userId: string) => userId,
  isUserAdminServer
);

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

async function languageOf(input: WorkspaceInput): Promise<PreferredLanguage> {
  return input.lang ?? (await apiLanguage());
}

export function parseCostingView(value: string | null): RecipeCostingView {
  // Vincular and Validar are one screen now; old links land on it.
  if (value === "plato" || value === "vincular" || value === "validar") {
    return "plato";
  }
  if (value === "preparaciones" || value === "menu-costeado") return value;
  return "resumen";
}

// R1-09c: the probe scanned pos_sales_items on every load; its answer
// only changes after a POS sync, so it is kept for 10 minutes.
// R1-12: it no longer waits for the product list (the caller applies
// hasCombos), so it runs in the same wave as every other read.
const probeComboSyncHint = ttlCached(
  10 * 60_000,
  (_s: SupabaseClient, companyId: string) => companyId,
  probeComboSyncHintUncached
);

async function probeComboSyncHintUncached(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
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

type WorkspaceInput = {
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
  /**
   * R1-13: the dish economics of the same restaurant and period, already
   * on its way. Several tabs asked together (one request) share one.
   */
  economics?: Promise<DishEconomicsLoad>;
  /** Language of the labels and messages; default: the company's. */
  lang?: PreferredLanguage;
};
export type WorkspaceLoad =
  | { ok: true; workspace: RecipeCostingWorkspace }
  | { ok: false; error: string };

/**
 * The period Menú › Platos opens on when the URL names none: the SAME month
 * Resumen shows by default (`resumenRange("month", lastDay)`: the first day of
 * the month of the last sales day → the last sales day), so the Platos KPIs
 * equal Resumen's. No sales at all = null (all history, nothing to default).
 */
export async function defaultPlatosPeriod(
  supabase: SupabaseClient,
  companyId: string,
  locationId?: string | null
): Promise<{ from: string; to: string; label: string } | null> {
  let q = supabase
    .from("pos_sales_items")
    .select("sale_date")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo");
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q
    .order("sale_date", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[recipe-costing] last sales day:", error.message);
    return null;
  }
  const last = (data?.[0] as { sale_date?: string } | undefined)?.sale_date;
  if (typeof last !== "string" || last.length < 10) return null;
  const lastDay = last.slice(0, 10);
  return { ...resumenRange("month", lastDay), label: monthLabel(lastDay) };
}

/**
 * Never throws: a failed read (a table that is not there, a database error,
 * a brand-new empty company hitting an unexpected shape) is an `ok: false`
 * the screen can show, not a server exception that takes the page down.
 */
export async function loadRecipeCostingWorkspace(
  supabase: SupabaseClient,
  input: WorkspaceInput
): Promise<WorkspaceLoad> {
  try {
    return await loadRecipeCostingWorkspaceUnsafe(supabase, input);
  } catch (err) {
    console.error(
      "[recipe-costing] workspace failed:",
      err instanceof Error ? (err.stack ?? err.message) : err
    );
    return {
      ok: false,
      error: getDictionary(await languageOf(input)).menu.workspace.server
        .workspaceLoadFailed,
    };
  }
}

async function loadRecipeCostingWorkspaceUnsafe(
  supabase: SupabaseClient,
  input: WorkspaceInput
): Promise<
  { ok: true; workspace: RecipeCostingWorkspace } | { ok: false; error: string }
> {
  const started = Date.now();
  const lang = await languageOf(input);
  const s = getDictionary(lang).menu.workspace.server;
  const view = input.view ?? "resumen";
  // Platos with no period in the URL opens on Resumen's month (see above),
  // unless a shared economics read (several tabs asked together) was passed.
  let defaulted: { label: string } | null = null;
  if (
    view === "plato" &&
    !input.startDate &&
    !input.endDate &&
    !input.economics
  ) {
    const period = await defaultPlatosPeriod(
      supabase,
      input.companyId,
      input.locationId
    );
    if (period) {
      input = { ...input, startDate: period.from, endDate: period.to };
      defaulted = { label: period.label };
    }
  }
  const editorOnly =
    view === "plato" &&
    input.editorOnly === true &&
    input.selectedOdooProductId != null;

  // R1-09a: the same loader as Menú, Cockpit and the email, so coverage is
  // one number everywhere. R1-13: tabs asked together share this read.
  const economicsRead = editorOnly
    ? null
    : (input.economics ??
      loadDishEconomics(
        input.companyId,
        input.startDate ?? null,
        input.endDate ?? null,
        input.locationId ?? null
      ));

  // R1-15h: the restaurants, for the row tags and group scope (one small read,
  // started now so it runs with the wave below).
  const restaurantsRead =
    view === "plato" || view === "preparaciones"
      ? Promise.resolve(
          supabase
            .from("restaurant_locations")
            .select("id, name")
            .eq("company_id", input.companyId)
            .order("name", { ascending: true })
        ).catch(() => ({ data: null }))
      : null;

  // R1-12: one wave. Nothing below depends on the product list, so links,
  // versions, menu items, upload history, the combo hint and the upload
  // draft are read together with it (they used to follow it, wave after
  // wave).
  const [
    list,
    roleLoad,
    companyName,
    currency,
    isMiltonStaff,
    linksRes,
    versionsRes,
    menuRes,
    history,
    comboHintProbe,
    draftRes,
    resetContext,
    preparationsOverview,
  ] = await Promise.all([
    editorOnly
      ? // R1-09c: after an edit, only the open dish's own sales (no
        // cost context): the list's numbers stay as last loaded.
        loadPosProductList(supabase, {
          companyId: input.companyId,
          startDate: input.startDate,
          endDate: input.endDate,
          locationId: input.locationId,
          odooProductId: input.selectedOdooProductId,
        }).then((res) =>
          res.ok ? { ok: true as const, list: res.list, economics: null } : res
        )
      : // R1-09a: the same loader as Menú, Cockpit and the email, so
        // coverage is one number everywhere.
        economicsRead!.then((res) =>
          res.ok
            ? { ok: true as const, list: res.list, economics: res.result }
            : res
        ),
    cachedRole(supabase, input.companyId, input.userId),
    cachedCompanyName(supabase, input.companyId),
    cachedCurrency(supabase, input.companyId),
    cachedIsAdmin(input.userId),
    fetchAllRows<Record<string, unknown>>(() => {
      const q = supabase
        .from("pos_product_links")
        .select(
          "id, company_id, location_id, odoo_product_id, odoo_name, classification, menu_item_id, link_state, confirmed_by, confirmed_at, confirmed_how, evidence"
        )
        .eq("company_id", input.companyId);
      // After an edit only the open dish's link (evidence is heavy).
      return editorOnly
        ? q.eq("odoo_product_id", input.selectedOdooProductId!)
        : q;
    }),
    fetchAllRows<WorkspaceVersion>(() =>
      supabase
        .from("recipe_versions")
        .select(
          "id, recipe_id, menu_item_id, version_number, status, effective_date, source_type, notes"
        )
        .eq("company_id", input.companyId)
    ),
    editorOnly
      ? Promise.resolve({ rows: [], truncated: false, error: null })
      : fetchAllRows<{
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
    editorOnly
      ? Promise.resolve([] as CostWorkbookBatchSummary[])
      : createSupabaseCostWorkbookRepo(supabase)
          .listLiveBatchSummaries(input.companyId)
          .catch(async (err): Promise<CostWorkbookBatchSummary[]> => {
            // Never hide a finished upload behind a failed summary read: log
            // it and fall back to the batch rows alone (no snapshot fields).
            console.error("[recetas] live batch summaries:", err);
            const { data, error } = await supabase
              .from("cost_import_batches")
              .select("id, filename, created_at, undone_at")
              .eq("company_id", input.companyId)
              .is("undone_at", null)
              .order("created_at", { ascending: false });
            if (error) {
              console.error("[recetas] live batches:", error.message);
              return [];
            }
            return ((data ?? []) as Array<Record<string, unknown>>).map(
              (row) => ({
                id: String(row.id),
                filename: String(row.filename ?? ""),
                created_at:
                  typeof row.created_at === "string"
                    ? row.created_at
                    : undefined,
                undone_at: null,
                has_recipe_blocks: false,
                is_recipe_import: /· recetas$/.test(String(row.filename ?? "")),
              })
            );
          }),
    editorOnly
      ? Promise.resolve(null)
      : probeComboSyncHint(supabase, input.companyId),
    // Leaving Resumen and coming back keeps the upload's choices (044):
    // a draft that is not fully saved reopens the upload step.
    view === "resumen"
      ? supabase
          .from("cost_upload_drafts")
          .select("catalog_result")
          .eq("company_id", input.companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // "Empezar de nuevo" (Resumen, owner/admin): only the role is awaited,
    // so the restaurant list loads with the rest.
    view === "resumen"
      ? cachedRole(supabase, input.companyId, input.userId).then((roleLoad) =>
          canManageCompanyCostReset(roleLoad)
            ? resolveRestaurantContext(
                supabase,
                input.companyId,
                input.locationId ?? null
              )
            : null
        )
      : Promise.resolve(null),
    // Preparaciones: its list rides in the same payload (built from the
    // product list already being read, so no second sales/versions read).
    view === "preparaciones" && economicsRead
      ? economicsRead
          .then((res) =>
            res.ok
              ? loadPreparationsOverview(supabase, {
                  companyId: input.companyId,
                  locationId: input.locationId ?? null,
                  list: res.list,
                })
              : null
          )
          .catch((err) => {
            console.error("[recetas] preparations overview:", err);
            return null;
          })
      : Promise.resolve(null),
  ]);
  if (list && !list.ok) return list;

  if (linksRes.error) {
    return { ok: false, error: s.linksReadFailed };
  }
  if (versionsRes.error) {
    return { ok: false, error: s.versionsReadFailed };
  }
  if (menuRes.error) {
    return { ok: false, error: "No se pudieron leer los platos." };
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

  const comboSyncHint =
    editorOnly || products.some((product) => product.is_combo)
      ? null
      : comboHintProbe;

  const confirmedAt = links
    .map((link) => link.confirmed_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const batchAt = batches[0]?.created_at ?? null;
  const lastAt = [confirmedAt, batchAt].filter(Boolean).sort().at(-1) ?? null;
  const lastProgress = lastAt
    ? fmt(s.lastProgress, { at: lastAt.slice(0, 16).replace("T", " ") })
    : s.lastProgressNone;

  // "Empezar de nuevo" lives on Resumen, for the owner or an admin only.
  let reset: RecipeCostingWorkspace["reset"] = null;
  if (view === "resumen" && resetContext) {
    const context = resetContext;
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
  const coverageTotals =
    list && list.ok
      ? (list.economics?.totals ?? {
          coverage_pct: list.list.coverage_pct,
          food_net_sales: list.list.food_net_sales,
          excluded_net_sales: list.list.excluded_net_sales,
          covered_net_sales: list.list.covered_net_sales,
        })
      : null;

  let uploadDraftPending = false;
  if (view === "resumen") {
    if (draftRes.error) {
      console.error("[recetas] upload draft:", draftRes.error.message);
    } else if (draftRes.data) {
      // The choices matter until the price list is saved.
      uploadDraftPending = !draftRes.data.catalog_result;
    }
  }

  const periodLabel = defaulted
    ? defaulted.label
    : input.startDate && input.endDate
      ? formatPageDateRangeLabel(
          { from: input.startDate, to: input.endDate },
          localeFor(lang)
        )
      : null;

  const built = buildRecipeCostingWorkspace({
    lang,
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
    restaurants: ((await restaurantsRead)?.data ?? []) as Array<{
      id: string;
      name: string;
    }>,
    viewLocationId: input.locationId ?? null,
    uploadDraftPending,
    timings: {
      load_ms: Date.now() - started,
      path: editorOnly ? "plato_editor" : "full",
    },
  });
  return {
    ok: true,
    workspace: preparationsOverview
      ? { ...built, preparations_overview: preparationsOverview }
      : built,
  };
}
