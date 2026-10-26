// «Copiar receta de…»: copies the lines of another plato's recipe into this
// product's own recipe as a NEW in-review DRAFT version, an independent copy
// that still needs approval. Rules:
// - The source recipe is only read, never changed.
// - An approved version is never changed: a new draft version is made next to
//   it (the same helpers «Crear versión nueva» uses).
// - If the target's current draft already has lines, nothing is written until
//   the caller says «replace» or «append» (no silent overwrite).
// - Every read and write is scoped by the company that came from auth.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { pickApprovedVersion } from "@/lib/restaurant/recipe-versions";
import type { VersionInput } from "./editor";
import type { EditorStore, VersionRef } from "./editor-service";
import { loadVersionLineCounts } from "./has-recipe-server";

export type CopyMode = "replace" | "append";

export interface CopyCandidate {
  menu_item_id: string;
  name: string;
  /** "aprobada" = the approved version in force; "borrador" = newest version with lines. */
  status: "aprobada" | "borrador";
  line_count: number;
}

export interface CopySource {
  menu_item_id: string;
  name: string;
  version_status: string;
  inputs: VersionInput[];
  /** The source product's yield, when its link carries one. */
  yield: Record<string, unknown> | null;
}

interface VersionRow {
  id: string;
  menu_item_id: string;
  status: string;
  version_number: number;
  effective_date: string | null;
}

function asVersionRow(row: Record<string, unknown>): VersionRow {
  return {
    id: String(row.id),
    menu_item_id: String(row.menu_item_id),
    status: String(row.status),
    version_number: Number(row.version_number),
    effective_date:
      typeof row.effective_date === "string" ? row.effective_date : null,
  };
}

/** The version to copy: the approved one in force, else the newest with lines. */
export function pickCopyVersion(
  versions: readonly VersionRow[],
  lineCounts: ReadonlyMap<string, number>
): { version: VersionRow; status: "aprobada" | "borrador" } | null {
  const approved = pickApprovedVersion([...versions]);
  if (approved && (lineCounts.get(approved.id) ?? 0) > 0) {
    return { version: approved, status: "aprobada" };
  }
  const withLines = [...versions]
    .filter((v) => (lineCounts.get(v.id) ?? 0) > 0)
    .sort((a, b) => b.version_number - a.version_number);
  return withLines[0] ? { version: withLines[0], status: "borrador" } : null;
}

/** Platos of THIS company with a recipe that has lines, approved first. */
export async function listCopyCandidates(
  supabase: SupabaseClient,
  companyId: string,
  options: { excludeMenuItemId?: string | null } = {}
): Promise<CopyCandidate[]> {
  const [items, versions, counts] = await Promise.all([
    fetchAllRows<{ id: string; name: string }>(() =>
      supabase.from("menu_items").select("id, name").eq("company_id", companyId)
    ),
    fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("recipe_versions")
        .select("id, menu_item_id, status, version_number, effective_date")
        .eq("company_id", companyId)
    ),
    loadVersionLineCounts(supabase, companyId),
  ]);
  if (items.error) throw new Error(items.error.message ?? "menu_items");
  if (versions.error) throw new Error(versions.error.message ?? "versions");
  const byItem = new Map<string, VersionRow[]>();
  for (const raw of versions.rows) {
    const row = asVersionRow(raw);
    const list = byItem.get(row.menu_item_id) ?? [];
    list.push(row);
    byItem.set(row.menu_item_id, list);
  }
  const out: CopyCandidate[] = [];
  for (const item of items.rows) {
    if (item.id === options.excludeMenuItemId) continue;
    const picked = pickCopyVersion(byItem.get(item.id) ?? [], counts);
    if (!picked) continue;
    out.push({
      menu_item_id: item.id,
      name: item.name,
      status: picked.status,
      line_count: counts.get(picked.version.id) ?? 0,
    });
  }
  return out.sort((a, b) =>
    a.status !== b.status
      ? a.status === "aprobada"
        ? -1
        : 1
      : a.name.localeCompare(b.name, "es")
  );
}

/** One source recipe, read-only. Null when it is not in this company or has no lines. */
export async function loadCopySource(
  supabase: SupabaseClient,
  store: Pick<EditorStore, "listInputs">,
  companyId: string,
  menuItemId: string
): Promise<CopySource | null> {
  const { data: item, error } = await supabase
    .from("menu_items")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("id", menuItemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!item) return null;
  const { data: rows, error: versionsError } = await supabase
    .from("recipe_versions")
    .select("id, menu_item_id, status, version_number, effective_date")
    .eq("company_id", companyId)
    .eq("menu_item_id", menuItemId);
  if (versionsError) throw new Error(versionsError.message);
  const versions = ((rows ?? []) as Record<string, unknown>[]).map(
    asVersionRow
  );
  const counts = await loadVersionLineCounts(
    supabase,
    companyId,
    versions.map((v) => v.id)
  );
  const picked = pickCopyVersion(versions, counts);
  if (!picked) return null;
  const ref: VersionRef = {
    id: picked.version.id,
    status: picked.version.status,
    kind: "dish",
    menu_item_id: menuItemId,
    version_number: picked.version.version_number,
    effective_date: picked.version.effective_date,
  };
  const inputs = await store.listInputs(companyId, ref);
  const links = await supabase
    .from("pos_product_links")
    .select("evidence")
    .eq("company_id", companyId)
    .eq("menu_item_id", menuItemId)
    .limit(10);
  let sourceYield: Record<string, unknown> | null = null;
  for (const link of (links.data ?? []) as Array<{ evidence?: unknown }>) {
    const ev = link.evidence;
    const y =
      ev && typeof ev === "object" && !Array.isArray(ev)
        ? (ev as Record<string, unknown>).yield
        : null;
    if (
      y &&
      typeof y === "object" &&
      Number((y as { value?: unknown }).value) > 0
    ) {
      sourceYield = y as Record<string, unknown>;
      break;
    }
  }
  return {
    menu_item_id: menuItemId,
    name: String(item.name ?? ""),
    version_status: picked.version.status,
    inputs,
    yield: sourceYield,
  };
}

export type CopyResult =
  | {
      ok: true;
      lines_copied: number;
      version_id: string;
      /** The recipe + link were created by this copy. */
      created_recipe: boolean;
      /** A new draft version was made (an approved one is in force). */
      created_draft: boolean;
      mode: CopyMode | null;
    }
  | {
      ok: false;
      error: string;
      status: number;
      /** The current draft has lines: ask the person, then call again with a mode. */
      needs_mode?: boolean;
      draft_line_count?: number;
    };

export async function copyRecipeLinesForCompany(input: {
  store: EditorStore;
  /** Read-only source (already company-scoped). */
  loadSource: (menuItemId: string) => Promise<CopySource | null>;
  /**
   * Creates the empty recipe + link for a product that has none (same as
   * «Crear receta»). It re-points ONLY this product's link; it is also used
   * when the product's current recipe is shared with another product.
   */
  createRecipe: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * True when another pos_product_link of the same company uses this recipe
   * (a shared recipe from «Usar la receta de otro plato»). `exceptLinkId` is
   * this product's own link.
   */
  isRecipeShared: (
    menuItemId: string,
    exceptLinkId: string
  ) => Promise<boolean>;
  companyId: string;
  odooProductId: number;
  locationId?: string | null;
  sourceMenuItemId: string;
  mode?: CopyMode | null;
}): Promise<CopyResult> {
  const { store, companyId } = input;
  // 1. The source first: a bad pick must not create anything.
  const source = await input.loadSource(input.sourceMenuItemId);
  if (!source) {
    return {
      ok: false,
      error: "No encontré esa receta, o todavía no tiene ingredientes.",
      status: 404,
    };
  }

  // 2. The target's link and recipe (create them when missing).
  let link = await store.loadLink(
    companyId,
    input.odooProductId,
    input.locationId ?? null
  );
  let createdRecipe = false;
  if (!link?.menu_item_id) {
    const created = await input.createRecipe();
    if (!created.ok) return { ok: false, error: created.error, status: 400 };
    createdRecipe = true;
    link = await store.loadLink(
      companyId,
      input.odooProductId,
      input.locationId ?? null
    );
  }
  if (!link?.menu_item_id) {
    return {
      ok: false,
      error: "No pude preparar la receta de este plato.",
      status: 500,
    };
  }
  // A recipe shared with another product is NEVER written into: the copy
  // must be independent, so this product first gets its own new recipe and
  // link (only its own link is re-pointed). The shared recipe, its drafts, its
  // approved version and the other products' links stay exactly as they were.
  if (
    !createdRecipe &&
    link.id &&
    (await input.isRecipeShared(link.menu_item_id, link.id))
  ) {
    const created = await input.createRecipe();
    if (!created.ok) return { ok: false, error: created.error, status: 400 };
    createdRecipe = true;
    link = await store.loadLink(
      companyId,
      input.odooProductId,
      input.locationId ?? null
    );
    if (!link?.menu_item_id) {
      return {
        ok: false,
        error: "No pude preparar la receta de este plato.",
        status: 500,
      };
    }
  }
  if (link.menu_item_id === source.menu_item_id) {
    return {
      ok: false,
      error: "Ese plato ya usa esa receta. Elige otro.",
      status: 400,
    };
  }
  const newest = await store.latestVersion(companyId, link.menu_item_id);
  if (!newest) {
    return {
      ok: false,
      error: "Este plato no tiene una versión de receta. Usa «Crear receta».",
      status: 409,
    };
  }

  // 3. A draft with lines is never overwritten without a clear answer.
  let draft: VersionRef;
  let createdDraft = false;
  if (newest.status === "in_review") {
    draft = newest;
    const existing = await store.listInputs(companyId, draft);
    if (existing.length > 0) {
      if (input.mode !== "replace" && input.mode !== "append") {
        return {
          ok: false,
          error: "El borrador ya tiene líneas. Elige qué hacer con ellas.",
          status: 409,
          needs_mode: true,
          draft_line_count: existing.length,
        };
      }
      if (input.mode === "replace") {
        for (const row of existing) {
          await store.deleteInput(companyId, draft, row.id);
        }
      }
    }
  } else {
    // An approved (or older) version stays exactly as it is.
    draft = await store.createDraftVersion(companyId, newest);
    createdDraft = true;
  }

  // 4. The copy: same ingredients, preparations, quantities and units.
  for (const row of source.inputs) {
    await store.insertInput(companyId, draft, {
      input_type: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      quantity: row.quantity,
      unit: row.unit,
      unit_cost: row.unit_cost ?? null,
      cost_source: row.cost_source ?? null,
    });
  }

  // 5. The yield, only when this product has none of its own (or the person
  // chose to replace). It is marked as assumed so it is confirmed on approval.
  if (source.yield && link.id) {
    const own = link.evidence?.yield;
    const hasOwn =
      own &&
      typeof own === "object" &&
      Number((own as { value?: unknown }).value) > 0;
    if (!hasOwn || input.mode === "replace") {
      await store.saveEvidence(
        companyId,
        { kind: "dish", id: link.id, evidence: link.evidence ?? {} },
        {
          ...(link.evidence ?? {}),
          yield: { ...source.yield, source: "assumed", confirmed: false },
        }
      );
    }
  }

  return {
    ok: true,
    lines_copied: source.inputs.length,
    version_id: draft.id,
    created_recipe: createdRecipe,
    created_draft: createdDraft,
    mode: input.mode ?? null,
  };
}
