// Where an ingredient is used: ONE pure core for the Ingredientes detail list
// ("Se usa en") and for every counter built from it (list rows, filters,
// "en uso"). Lists every dish AND preparation of the company that uses the
// ingredient in any current version: approved, in review, a pending kitchen
// draft, or an Excel-imported recipe; directly, through a preparation (nested
// too, with a cycle guard), through an alias, or through a merged duplicate.
// Pure: the server loader in ingredient-uses-server.ts feeds it.

import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";
import { dishHref, preparationHref } from "@/lib/restaurant/menu-links";

export type IngredientUseStatus =
  | "aprobada"
  | "en_revision"
  | "borrador_cocina"
  | "del_excel";

export const USE_STATUS_LABEL: Record<IngredientUseStatus, string> = {
  aprobada: "Aprobada",
  en_revision: "En revisión",
  borrador_cocina: "Borrador de cocina",
  del_excel: "Del Excel",
};

const STATUS_ORDER: IngredientUseStatus[] = [
  "aprobada",
  "en_revision",
  "borrador_cocina",
  "del_excel",
];

export interface IngredientUseEntry {
  /** Stable, unique per listed recipe. */
  key: string;
  kind: "plato" | "preparacion";
  name: string;
  status: IngredientUseStatus;
  statusLabel: string;
  /** Quantity and unit when the recipe names the ingredient on a line of its own. */
  qty: number | null;
  unit: string | null;
  /** «a través de la preparación X» / «por el alias …» / «ingrediente unido». */
  via: string | null;
  href: string;
}

export interface UsesLine {
  input_type: "ingredient" | "component";
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
}

export interface UsesVersion {
  id: string;
  version_number: number;
  /** recipe_versions.status: approved | in_review | archived. */
  status: string;
  source_type?: string | null;
}

export interface UsesDraftLine {
  ingredient_id: string | null;
  raw_name: string;
  quantity: number | null;
  unit: string | null;
}

export interface UsesDraft {
  id: string;
  dish_name: string;
  lines: readonly UsesDraftLine[];
}

export interface IngredientUsesInput {
  dishes: ReadonlyMap<string, { name: string; odooProductId: number | null }>;
  dishVersions: ReadonlyMap<string, readonly UsesVersion[]>;
  dishInputsByVersionId: ReadonlyMap<string, readonly UsesLine[]>;
  /** Excel-imported lines (menu_recipe_inputs), by menu item. */
  legacyDishLines: ReadonlyMap<string, readonly UsesLine[]>;
  components: ReadonlyMap<string, { name: string }>;
  componentVersions: ReadonlyMap<string, readonly UsesVersion[]>;
  componentInputsByVersionId: ReadonlyMap<string, readonly UsesLine[]>;
  legacyComponentLines: ReadonlyMap<string, readonly UsesLine[]>;
  /** Pending kitchen drafts (draft / awaiting_portions). */
  drafts: readonly UsesDraft[];
  /** alias_key (see aliasKeyFor) -> ingredient id. */
  aliases: ReadonlyMap<string, string>;
  /** Merged-away ingredient id -> survivor id. */
  mergedInto: ReadonlyMap<string, string>;
}

export const KITCHEN_HREF = "/dashboard/restaurant/kitchen";

interface Source {
  status: IngredientUseStatus;
  lines: readonly UsesLine[];
}

function latest(
  versions: readonly UsesVersion[],
  status: string
): UsesVersion | null {
  return (
    versions
      .filter((v) => v.status === status)
      .sort((a, b) => b.version_number - a.version_number)[0] ?? null
  );
}

/** The current versions of one recipe, newest approved first, then in review; Excel lines when it has no version. */
function sourcesOf(
  versions: readonly UsesVersion[] | undefined,
  inputs: ReadonlyMap<string, readonly UsesLine[]>,
  legacy: readonly UsesLine[] | undefined
): Source[] {
  const live = (versions ?? []).filter((v) => v.status !== "archived");
  if (live.length === 0)
    return legacy && legacy.length > 0
      ? [{ status: "del_excel", lines: legacy }]
      : [];
  const out: Source[] = [];
  const approved = latest(live, "approved");
  if (approved)
    out.push({ status: "aprobada", lines: inputs.get(approved.id) ?? [] });
  const review = latest(live, "in_review");
  if (review)
    out.push({
      status:
        review.source_type === "kitchen_draft"
          ? "borrador_cocina"
          : "en_revision",
      lines: inputs.get(review.id) ?? [],
    });
  return out;
}

function sumQty(
  lines: readonly { quantity: number | null; unit: string | null }[]
): { qty: number | null; unit: string | null } {
  const first = lines[0];
  if (!first || first.quantity == null) return { qty: null, unit: null };
  const sameUnit = lines.every(
    (l) => l.unit === first.unit && l.quantity != null
  );
  return {
    qty: sameUnit
      ? lines.reduce((s, l) => s + (l.quantity ?? 0), 0)
      : first.quantity,
    unit: first.unit,
  };
}

export function computeIngredientUses(
  input: IngredientUsesInput
): Map<string, IngredientUseEntry[]> {
  const out = new Map<string, IngredientUseEntry[]>();

  const survivor = (id: string): { id: string; merged: boolean } => {
    let cur = id;
    let merged = false;
    const seen = new Set<string>();
    while (input.mergedInto.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = input.mergedInto.get(cur) as string;
      merged = true;
    }
    return { id: cur, merged };
  };

  /** A line's ingredient: its id, or the alias its raw name matches; lines on a merged-away ingredient count for the survivor. */
  const resolve = (
    ingredientId: string | null,
    rawName?: string
  ): { id: string; via: string | null } | null => {
    if (ingredientId) {
      const s = survivor(ingredientId);
      return { id: s.id, via: s.merged ? "ingrediente unido" : null };
    }
    const key = rawName ? aliasKeyFor(rawName) : "";
    const aliased = key ? input.aliases.get(key) : undefined;
    if (!aliased) return null;
    const s = survivor(aliased);
    return {
      id: s.id,
      via: `por el alias «${rawName?.trim()}»${s.merged ? " · ingrediente unido" : ""}`,
    };
  };

  // Ingredients each preparation reaches (its own lines and nested
  // preparations). Memoised; a loop in the data cannot hang it.
  const reachMemo = new Map<string, Set<string>>();
  const visiting = new Set<string>();
  const reachOf = (componentId: string): Set<string> => {
    const known = reachMemo.get(componentId);
    if (known) return known;
    const res = new Set<string>();
    if (visiting.has(componentId)) return res;
    visiting.add(componentId);
    for (const src of sourcesOf(
      input.componentVersions.get(componentId),
      input.componentInputsByVersionId,
      input.legacyComponentLines.get(componentId)
    )) {
      for (const line of src.lines) {
        if (line.input_type === "ingredient") {
          const r = resolve(line.ingredient_id);
          if (r) res.add(r.id);
        } else if (line.component_id) {
          for (const id of reachOf(line.component_id)) res.add(id);
        }
      }
    }
    visiting.delete(componentId);
    reachMemo.set(componentId, res);
    return res;
  };

  const push = (id: string, e: Omit<IngredientUseEntry, "statusLabel">) => {
    const list = out.get(id) ?? [];
    if (list.some((x) => x.key === e.key)) return;
    list.push({ ...e, statusLabel: USE_STATUS_LABEL[e.status] });
    out.set(id, list);
  };
  const joinVia = (...parts: (string | null)[]) =>
    parts.filter(Boolean).join(" · ") || null;

  // Dishes and preparations: each recipe once per ingredient (the first
  // current version that names it wins; direct beats through a preparation).
  const walk = (
    kind: "plato" | "preparacion",
    ownerId: string,
    name: string,
    href: string,
    sources: Source[]
  ) => {
    const seen = new Set<string>();
    for (const src of sources) {
      const direct = new Map<
        string,
        { lines: UsesLine[]; via: string | null }
      >();
      const through = new Map<string, string>();
      for (const line of src.lines) {
        if (line.input_type === "ingredient") {
          const r = resolve(line.ingredient_id);
          if (!r) continue;
          const cur = direct.get(r.id) ?? { lines: [], via: r.via };
          cur.lines.push(line);
          direct.set(r.id, cur);
        } else if (line.component_id) {
          const prep = input.components.get(line.component_id);
          for (const id of reachOf(line.component_id))
            if (!through.has(id))
              through.set(
                id,
                `a través de la preparación ${prep?.name ?? "—"}`
              );
        }
      }
      for (const [id, d] of direct) {
        if (seen.has(id)) continue;
        seen.add(id);
        const q = sumQty(
          d.lines.map((l) => ({ quantity: l.quantity, unit: l.unit }))
        );
        push(id, {
          key: `${kind}:${ownerId}`,
          kind,
          name,
          status: src.status,
          qty: q.qty,
          unit: q.unit,
          via: d.via,
          href,
        });
      }
      for (const [id, via] of through) {
        if (seen.has(id)) continue;
        seen.add(id);
        push(id, {
          key: `${kind}:${ownerId}`,
          kind,
          name,
          status: src.status,
          qty: null,
          unit: null,
          via,
          href,
        });
      }
    }
  };

  for (const [menuItemId, dish] of input.dishes) {
    walk(
      "plato",
      menuItemId,
      dish.name,
      dish.odooProductId != null
        ? dishHref(dish.odooProductId)
        : "/dashboard/restaurant/menu/platos",
      sourcesOf(
        input.dishVersions.get(menuItemId),
        input.dishInputsByVersionId,
        input.legacyDishLines.get(menuItemId)
      )
    );
  }
  for (const [componentId, comp] of input.components) {
    walk(
      "preparacion",
      componentId,
      comp.name,
      preparationHref(componentId),
      sourcesOf(
        input.componentVersions.get(componentId),
        input.componentInputsByVersionId,
        input.legacyComponentLines.get(componentId)
      )
    );
  }

  // Pending kitchen drafts: not costed yet, but someone is building them.
  for (const draft of input.drafts) {
    const byIngredient = new Map<
      string,
      { lines: UsesDraftLine[]; via: string | null }
    >();
    for (const line of draft.lines) {
      const r = resolve(line.ingredient_id, line.raw_name);
      if (!r) continue;
      const cur = byIngredient.get(r.id) ?? { lines: [], via: r.via };
      cur.lines.push(line);
      byIngredient.set(r.id, cur);
    }
    for (const [id, d] of byIngredient) {
      const q = sumQty(
        d.lines.map((l) => ({ quantity: l.quantity, unit: l.unit }))
      );
      push(id, {
        key: `borrador:${draft.id}`,
        kind: "plato",
        name: draft.dish_name,
        status: "borrador_cocina",
        qty: q.qty,
        unit: q.unit,
        via: joinVia(d.via),
        href: KITCHEN_HREF,
      });
    }
  }

  for (const list of out.values())
    list.sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        a.name.localeCompare(b.name)
    );
  return out;
}
