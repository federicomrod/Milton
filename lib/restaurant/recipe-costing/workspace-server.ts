import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  loadCompanyMembershipRole,
  loadCompanyName,
} from "@/lib/restaurant/cost-workbook/reset-auth";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { listCostImportHistory } from "@/lib/restaurant/cost-workbook/history";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { formatPageDateRangeLabel } from "@/lib/restaurant/page-date-range";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import {
  isPosProductClassification,
  isPosProductLinkState,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import {
  buildRecipeCostingWorkspace,
  type RecipeCostingView,
  type RecipeCostingWorkspace,
  type WorkspaceVersion,
} from "./workspace";

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
    classification: isPosProductClassification(row.classification)
      ? row.classification
      : "por_clasificar",
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
  if (
    value === "vincular" ||
    value === "validar" ||
    value === "menu-costeado"
  ) {
    return value;
  }
  return "resumen";
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
  }
): Promise<
  { ok: true; workspace: RecipeCostingWorkspace } | { ok: false; error: string }
> {
  const [list, roleLoad, companyName, currency, isMiltonStaff] =
    await Promise.all([
      loadPosProductList(supabase, {
        companyId: input.companyId,
        startDate: input.startDate,
        endDate: input.endDate,
        locationId: input.locationId,
      }),
      loadCompanyMembershipRole(supabase, input.companyId, input.userId),
      loadCompanyName(supabase, input.companyId),
      resolveCompanyCurrency(supabase, input.companyId),
      isUserAdminServer(input.userId),
    ]);
  if (!list.ok) return list;

  const [linksRes, versionsRes, menuRes] = await Promise.all([
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
    fetchAllRows<{ id: string; name: string }>(() =>
      supabase
        .from("menu_items")
        .select("id, name")
        .eq("company_id", input.companyId)
    ),
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

  let batches: RecipeCostingWorkspace["batches"] = [];
  try {
    const history = await listCostImportHistory(
      createSupabaseCostWorkbookRepo(supabase),
      input.companyId
    );
    batches = history
      .filter((row) => row.status === "live")
      .map((row) => ({
        id: row.id,
        filename: row.filename,
        created_at: row.created_at,
        can_undo: row.status === "live",
      }));
  } catch {
    batches = [];
  }

  const links = (linksRes.rows ?? [])
    .map(asLink)
    .filter((row): row is PosProductLinkRecord => row !== null);

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
      view: input.view ?? "resumen",
      actor: {
        user_id: input.userId,
        role: roleLoad.role,
        is_milton_staff: isMiltonStaff,
      },
      products: list.list.products,
      links,
      versions: versionsRes.rows ?? [],
      menuItems: menuRes.rows ?? [],
      batches,
      coveragePct: list.list.coverage_pct,
      netSales: list.list.net_sales,
      coveredNetSales: list.list.covered_net_sales,
      selectedOdooProductId: input.selectedOdooProductId ?? null,
      lastProgress,
    }),
  };
}
