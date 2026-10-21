"use client";

// R1-15c (mocks 7 and 9): Platos › Productos. Every POS product on one list,
// grouped under the person's groups and the Plato del menú level, with the
// Todos / Agrupados / Sin agrupar filter, multi-select and the dark action
// bar. Every figure is the roll-up of costing/rollup.ts; this file only
// arranges rows and calls the pure actions of group-ops.

import { memo, useCallback, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import {
  buildGroupTree,
  costPctLabel,
  groupingCounts,
  leavesUnder,
  marginLabel,
  type TreeLeaf,
  type TreeNode,
} from "@/lib/restaurant/costing/rollup";
import { productTreeInputs } from "@/lib/restaurant/groups/item-groups";
import {
  addToGroup,
  createGroup,
  groupPath,
  mergeGroups,
  moveGroup,
  removeFromGroups,
  renameGroup,
  ungroupGroup,
  type DishRef,
  type ItemRef,
} from "@/lib/restaurant/groups/group-ops";
import {
  sharedSuggestion,
  suggestGroup,
  type SuggestTarget,
  type Suggestion,
} from "@/lib/restaurant/groups/suggest";
import type { MenuDish } from "@/lib/restaurant/menu-dishes/menu-dishes";
import { leavesFromMenuDishes } from "@/lib/restaurant/groups/item-groups";
import {
  GroupMenu,
  GroupPicker,
  SuggestionChip,
  type GroupOption,
  type GroupingFilterValue,
} from "./GroupingControls";
import { GroupingToolbar } from "./GroupingToolbar";
import {
  useGroupFocus,
  useRememberedSet,
  type useItemGroups,
} from "./use-item-groups";
import { RowActions } from "./RowActions";
import { StickyPanel, STICKY_TH } from "@/components/restaurant/ui/StickyPanel";
import { duplicateHint as findDuplicates } from "@/lib/restaurant/groups/duplicates";
import { MiltonMark, MiltonSuggestions } from "./MiltonSuggestions";
import { useMiltonSuggestions } from "./use-milton-suggestions";
import { SearchBox } from "@/components/restaurant/ui/SearchBox";
import { useProgressiveCount } from "./use-progressive";
import { SortTh } from "@/components/restaurant/sort/SortTh";
import { useTableSort } from "@/components/restaurant/sort/use-table-sort";
import { foldText, searchTree } from "@/lib/restaurant/groups/search";
import {
  sortRows,
  sortTree,
  type SortValue,
} from "@/lib/restaurant/table-sort";

/** The figures a column sorts by. A missing price is null: last both ways. */
function nodeValue(
  node: { name: string; rollup: TreeNode["rollup"]; share_pct: number },
  key: string
): SortValue {
  switch (key) {
    case "name":
      return node.name;
    case "sales":
      return node.rollup.net_sales;
    case "margin":
      return node.rollup.margin_pct;
    case "cost":
      return node.rollup.food_cost_pct;
    case "share":
      return node.rollup.net_sales;
    default:
      return null;
  }
}

function leafValue(leaf: TreeLeaf, key: string): SortValue {
  const known = leaf.cost_total !== null && leaf.net_sales > 0;
  switch (key) {
    case "name":
      return leaf.name;
    case "sales":
    case "share":
      return leaf.net_sales;
    case "margin":
      return known
        ? ((leaf.net_sales - leaf.cost_total!) / leaf.net_sales) * 100
        : null;
    case "cost":
      return known ? (leaf.cost_total! / leaf.net_sales) * 100 : null;
    default:
      return null;
  }
}

const HIERARCHY = { scope: "product" as const };
const uuid = () => crypto.randomUUID();

export function ProductosView({
  dishes,
  excluded,
  grouping,
  canEdit,
  money,
  onAddToDish,
  onDrillDish,
  onDrillGroup,
  onOpenRecipe,
  restaurants = [],
  viewLocationId = null,
  leading,
}: {
  dishes: readonly MenuDish[];
  excluded: readonly MenuDish[];
  grouping: ReturnType<typeof useItemGroups>;
  canEdit: boolean;
  money: (n: number) => string;
  /** Add products to a menu dish: the same "mover variante" as the Platos view. */
  onAddToDish: (productIds: number[], dish: MenuDish) => void;
  /** Open the drill view of a dish, or of a group (all its members). */
  onDrillDish: (dishId: string) => void;
  onDrillGroup: (name: string, variantKeys: string[]) => void;
  onOpenRecipe: (odooProductId: number) => void;
  /** The company's restaurants, in a stable order (R1, R2…). */
  restaurants?: ReadonlyArray<{ id: string; name: string }>;
  /** The restaurant in view; null = Todos los restaurantes. */
  viewLocationId?: string | null;
  /** The screen's own controls (view toggle…), kept in the sticky panel with the rest. */
  leading?: React.ReactNode;
}) {
  const [filter, setFilter] = useState<GroupingFilterValue>("todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    kind: "combine" | "move";
    groupId: string;
  } | null>(null);
  const open = useRememberedSet("milton:productos:abiertos");
  const [query, setQuery] = useState("");
  const { sort, toggle: toggleSort } = useTableSort("productos");
  const highlightId = useGroupFocus(grouping, open, () => {
    setQuery("");
    setFilter((f) => (f === "sin_agrupar" ? "agrupados" : f));
  });

  // Todos los restaurantes: groups and suggestions never mix restaurants; rows carry
  // no restaurant tag (the restaurant is the top selector; its name shows in the detail).
  const multi = restaurants.length > 1 && !viewLocationId;
  /** The restaurant's real name (the choice of restaurant is the top-left selector). */
  const tagOf = useCallback(
    (id: string | null | undefined): string | null =>
      id ? (restaurants.find((r) => r.id === id)?.name ?? null) : null,
    [restaurants]
  );

  const tree = useMemo(() => {
    const inputs = productTreeInputs({
      available: true,
      groups: grouping.state.groups,
      members: grouping.state.members,
    });
    return buildGroupTree({
      leaves: leavesFromMenuDishes(dishes, excluded),
      ...inputs,
    });
  }, [dishes, excluded, grouping.state]);

  // Counts are by product (a restaurant part is the same product).
  const { counts, ungroupedRefs, leafByRef } = useMemo(() => {
    const byRef = new Map<string, TreeLeaf>();
    const refs = new Set<string>();
    for (const n of leavesUnderAll(tree.top)) {
      refs.add(n.ref);
      if (!byRef.has(n.ref)) byRef.set(n.ref, n);
    }
    const ungrouped = new Set(tree.ungrouped.map((l) => l.ref));
    const c = groupingCounts(tree);
    return {
      counts: {
        all: refs.size,
        grouped: refs.size - ungrouped.size,
        ungrouped: ungrouped.size,
        sales: c.ungrouped_sales,
        share: c.ungrouped_share_pct,
      },
      ungroupedRefs: ungrouped,
      leafByRef: byRef,
    };
  }, [tree]);

  const userGroups = useMemo(
    () =>
      grouping.state.groups.filter(
        (g) =>
          g.scope === "product" &&
          g.source !== "auto" &&
          g.status === "confirmed" &&
          // One restaurant in view: another restaurant's own groups are not offered.
          (!viewLocationId ||
            !g.restaurant_id ||
            g.restaurant_id === viewLocationId)
      ),
    [grouping.state.groups, viewLocationId]
  );
  const groupOptions: GroupOption[] = useMemo(
    () =>
      userGroups
        .map((g) => ({
          id: g.id,
          name: g.name,
          path:
            groupPath(grouping.state, g.id) +
            (multi && g.restaurant_id ? ` · ${tagOf(g.restaurant_id)}` : ""),
        }))
        .sort((a, b) => a.path.localeCompare(b.path, "es")),
    [userGroups, grouping.state, multi, tagOf]
  );
  const pickerOptions = useMemo(
    () => [
      ...dishes.map((d) => ({
        id: d.id,
        name: d.name,
        path: `Plato · ${d.name}`,
        kind: "dish" as const,
      })),
      ...groupOptions.map((o) => ({ ...o, kind: "group" as const })),
    ],
    [dishes, groupOptions]
  );

  // Milton's suggestions for the products in no group (names and categories).
  const categoryByKey = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const d of [...dishes, ...excluded])
      for (const v of d.variants) m.set(v.key, d.category);
    return m;
  }, [dishes, excluded]);
  const ungroupedItems = useMemo(() => {
    const seen = new Set<string>();
    return tree.ungrouped
      .filter((l) => (seen.has(l.ref) ? false : (seen.add(l.ref), true)))
      .map((l) => ({
        ref: l.ref,
        name: l.name,
        category: categoryByKey.get(l.key) ?? null,
        restaurant: l.restaurant_ids?.length === 1 ? l.restaurant_ids[0] : null,
      }));
  }, [tree.ungrouped, categoryByKey]);
  // Names already used in a restaurant's own scope (its groups and the shared ones).
  const takenNames = useCallback(
    (restaurantId: string | null) => [
      ...grouping.state.groups
        .filter(
          (g) =>
            g.scope === "product" &&
            (!multi || !g.restaurant_id || g.restaurant_id === restaurantId)
        )
        .map((g) => g.name),
      ...dishes.map((d) => d.name),
    ],
    [grouping.state.groups, dishes, multi]
  );
  const milton = useMiltonSuggestions({
    scope: "product",
    grouping,
    ungrouped: ungroupedItems,
    takenNames,
    enabled: canEdit && grouping.available,
    perRestaurant: multi,
  });

  // Search finds groups and products; sort orders groups among themselves
  // and the children inside each group (children stay under their parent).
  const { visibleTop, searchOpen } = useMemo(() => {
    const base =
      filter === "todos"
        ? tree.top
        : filter === "agrupados"
          ? tree.top.filter((n) => n.kind === "group")
          : [];
    const found = searchTree(base, query);
    return {
      visibleTop: sortTree(found.nodes, sort, nodeValue),
      searchOpen: found.open,
    };
  }, [filter, tree.top, query, sort]);
  const openIds = useMemo(
    () => new Set([...open.set, ...searchOpen]),
    [open.set, searchOpen]
  );
  const ungroupedLeaves = useMemo(() => {
    const seen = new Set<string>();
    const q = foldText(query);
    const list = tree.ungrouped.filter((l) =>
      seen.has(l.ref) || (q && !foldText(l.name).includes(q))
        ? false
        : (seen.add(l.ref), true)
    );
    const previewed = milton.previewRefs
      ? list.filter((l) => milton.previewRefs!.has(l.ref))
      : list;
    return sortRows(previewed, sort, leafValue);
  }, [tree.ungrouped, query, sort, milton.previewRefs]);

  // Suggestions: heuristics only, worked out when a row (or the selection)
  // needs one, and remembered until the groups change.
  const suggestionOf = useMemo(() => {
    const targets: SuggestTarget[] = dishes.map(
      (d): SuggestTarget => ({ id: d.id, name: d.name, kind: "dish" })
    );
    const nodes: TreeNode[] = [];
    collect(tree.top, nodes);
    for (const n of nodes) {
      if (n.kind !== "group" || !n.group || n.group.source === "auto") continue;
      targets.push({
        id: n.group.id,
        name: n.name,
        kind: "group",
        memberNames: leavesUnder(n).map((l) => l.name),
      });
    }
    const cache = new Map<string, Suggestion | null>();
    return (ref: string): Suggestion | null => {
      if (cache.has(ref)) return cache.get(ref) ?? null;
      const leaf = leafByRef.get(ref);
      const found = leaf ? suggestGroup(leaf.name, targets) : null;
      cache.set(ref, found);
      return found;
    };
  }, [dishes, tree, leafByRef]);

  // Only what is on screen can be selected, acted on or counted.
  const renderedRefs = useMemo(() => {
    const out = new Set<string>();
    if (filter === "sin_agrupar") {
      for (const l of ungroupedLeaves) out.add(l.ref);
      return out;
    }
    const walk = (nodes: readonly TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === "leaf" && n.leaf) out.add(n.leaf.ref);
        else if (openIds.has(n.id)) walk(n.children);
      }
    };
    walk(visibleTop);
    return out;
  }, [filter, ungroupedLeaves, visibleTop, openIds]);

  const selectedRefs = [...selected].filter((r) => renderedRefs.has(r));
  const shared = sharedSuggestion(
    new Map(selectedRefs.map((r) => [r, suggestionOf(r)])),
    selectedRefs
  );
  const selectedSales = selectedRefs.reduce(
    (s, r) => s + (leafByRef.get(r)?.net_sales ?? 0),
    0
  );
  const duplicates = useMemo(
    () =>
      selectedRefs.length >= 2
        ? findDuplicates(
            selectedRefs.map((r) => {
              const leaf = leafByRef.get(r)!;
              return {
                ref: r,
                name: leaf.name,
                restaurant:
                  leaf.restaurant_ids?.length === 1
                    ? leaf.restaurant_ids[0]
                    : null,
              };
            })
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, renderedRefs, leafByRef]
  );
  const explicitRefs = useMemo(
    () =>
      new Set(
        grouping.state.members
          .filter((m) => m.member_type === "pos_product")
          .map((m) => m.member_ref)
      ),
    [grouping.state.members]
  );

  const clear = () => setSelected(new Set());
  const toggleSelect = useCallback(
    (ref: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(ref)) next.delete(ref);
        else next.add(ref);
        return next;
      }),
    []
  );

  /** Products with a dish nest by the dish; the rest are plain members. */
  function split(refs: readonly string[]): {
    items: ItemRef[];
    dishRefs: DishRef[];
  } {
    const items: ItemRef[] = [];
    const dishRefs: DishRef[] = [];
    const seen = new Set<string>();
    for (const ref of refs) {
      const leaf = leafByRef.get(ref);
      if (!leaf) continue;
      if (leaf.menu_dish_id) {
        if (seen.has(leaf.menu_dish_id)) continue;
        seen.add(leaf.menu_dish_id);
        dishRefs.push({
          menu_dish_id: leaf.menu_dish_id,
          name: leaf.menu_dish_name ?? leaf.name,
          restaurant_id: null,
        });
      } else {
        items.push({ type: "pos_product", ref });
      }
    }
    return { items, dishRefs };
  }

  async function addRefsTo(
    refs: readonly string[],
    target: { id: string; kind?: "dish" | "group" }
  ) {
    if (target.kind === "dish") {
      const dish = dishes.find((d) => d.id === target.id);
      if (dish) onAddToDish(refs.map(Number), dish);
      clear();
      return;
    }
    const group = grouping.state.groups.find((g) => g.id === target.id);
    if (group?.restaurant_id) {
      const other = refs.find((r) => {
        const ids = leafByRef.get(r)?.restaurant_ids;
        return !ids || ids.length !== 1 || ids[0] !== group.restaurant_id;
      });
      if (other) {
        grouping.notify(
          `«${group.name}» es de ${tagOf(group.restaurant_id) ?? "un restaurante"}: no puede incluir productos de otro restaurante.`,
          true
        );
        return;
      }
    }
    const { items, dishRefs } = split(refs);
    clear();
    await grouping.run((s) =>
      addToGroup(s, {
        groupId: target.id,
        items,
        dishes: dishRefs,
        uuid,
      })
    );
  }

  /** The ONE restaurant a set of products belongs to (Todos los restaurantes), else null = shared. */
  function restaurantOf(refs: readonly string[]): string | null {
    if (!multi) return null;
    const ids = new Set<string>();
    for (const r of refs) {
      const rs = leafByRef.get(r)?.restaurant_ids;
      if (!rs || rs.length !== 1) return null;
      ids.add(rs[0]);
    }
    return ids.size === 1 ? [...ids][0] : null;
  }

  async function groupAs(
    name: string,
    parentId: string | null,
    refs: readonly string[] = selectedRefs
  ) {
    const { items, dishRefs } = split(refs);
    const restaurantId = restaurantOf(refs);
    clear();
    await grouping.run((s) =>
      createGroup(s, {
        name,
        hierarchy: HIERARCHY,
        parentId,
        restaurantId,
        items,
        dishes: dishRefs,
        uuid,
      })
    );
  }

  async function ungroupSelected() {
    const { items, dishRefs } = split(selectedRefs);
    clear();
    await grouping.run((s) => removeFromGroups(s, { items, dishes: dishRefs }));
  }

  const onRename = useCallback(
    (id: string, name: string) => {
      setRenaming(null);
      void grouping.run((s) => renameGroup(s, id, name));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouping.run]
  );
  const onUngroupGroup = useCallback(
    (id: string) => void grouping.run((s) => ungroupGroup(s, id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouping.run]
  );
  const onPicker = useCallback(
    (kind: "combine" | "move", groupId: string) => setPicker({ kind, groupId }),
    []
  );
  const dishById = useMemo(
    () => new Map(dishes.map((d) => [d.id, d])),
    [dishes]
  );
  /** The menu dish a node stands for (its auto level), if it is one. */
  const dishOfNode = useCallback(
    (node: TreeNode): MenuDish | null => {
      if (!(node.group?.source === "auto" || node.virtual)) return null;
      const id = leavesUnder(node)[0]?.menu_dish_id;
      return id ? (dishById.get(id) ?? null) : null;
    },
    [dishById]
  );
  const onDrillNode = useCallback(
    (node: TreeNode) => {
      const dish = dishOfNode(node);
      if (dish) onDrillDish(dish.id);
      else
        onDrillGroup(
          node.name,
          leavesUnder(node).map((l) => l.key)
        );
    },
    [dishOfNode, onDrillDish, onDrillGroup]
  );
  const onRecipeNode = useCallback(
    (node: TreeNode) => {
      const base = dishOfNode(node)?.base_odoo_product_id;
      if (base != null) onOpenRecipe(base);
    },
    [dishOfNode, onOpenRecipe]
  );
  const shownRows = useProgressiveCount(
    filter === "sin_agrupar" ? ungroupedLeaves.length : visibleTop.length,
    `${filter}|${query}|${sort?.key}|${sort?.dir}`
  );
  const totalSales = tree.total.net_sales;

  const note =
    counts.ungrouped > 0 && counts.share !== null
      ? `${money(counts.sales)} en ventas sin agrupar · ${counts.share.toLocaleString("es", { maximumFractionDigits: 1 })}%`
      : null;

  const parentOptions = groupOptions;

  return (
    <div className="space-y-3" data-testid="productos-view">
      {!grouping.available ? (
        <p className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-[13px]">
          Para agrupar falta aplicar las migraciones 048 y 049 en este ambiente.
          Mientras tanto puedes ver los productos, no guardar grupos.
        </p>
      ) : null}
      <StickyPanel>
        {leading}
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar producto o grupo…"
          className="max-w-xl"
        />
        {canEdit && grouping.available ? (
          <MiltonSuggestions
            clusters={milton.clusters}
            preview={milton.preview}
            onPreview={(c) => {
              setFilter("sin_agrupar");
              setQuery("");
              milton.startPreview(c);
            }}
            onApply={(c, name) => void milton.apply(c, name)}
            onDismiss={(c) => void milton.dismiss(c)}
            onEndPreview={milton.endPreview}
            onAskAi={() => void milton.askAi()}
            aiBusy={milton.aiBusy}
            canAskAi={milton.canAskAi}
          />
        ) : null}
        <GroupingToolbar
          grouping={grouping}
          filter={filter}
          onFilter={setFilter}
          counts={counts}
          note={note}
          selectedCount={canEdit ? selectedRefs.length : 0}
          selectionSummary={money(selectedSales)}
          sharedSuggestion={shared}
          anySelectedGrouped={selectedRefs.some(
            (r) => explicitRefs.has(r) || !ungroupedRefs.has(r)
          )}
          pickerOptions={pickerOptions}
          parentOptions={parentOptions}
          onAddToExisting={(t) => void addRefsTo(selectedRefs, t)}
          onGroupAs={(name, parent) => void groupAs(name, parent)}
          selectionNote={
            multi &&
            selectedRefs.length > 1 &&
            restaurantOf(selectedRefs) === null
              ? "La selección mezcla restaurantes (o productos de ambos): el grupo será compartido."
              : null
          }
          duplicateHint={duplicates}
          onDuplicateGroup={(name, refs) => void groupAs(name, null, refs)}
          onUngroup={() => void ungroupSelected()}
          onAcceptShared={() => shared && void addRefsTo(selectedRefs, shared)}
          onClearSelection={clear}
          defaultNewName={leafByRef.get(selectedRefs[0] ?? "")?.name}
        />

        {picker ? (
          <GroupPicker
            title={
              picker.kind === "combine"
                ? "Combinar con…"
                : "Mover el grupo dentro de…"
            }
            allowTop={picker.kind === "move"}
            options={groupOptions.filter((o) => o.id !== picker.groupId)}
            onCancel={() => setPicker(null)}
            onPick={(id) => {
              const p = picker;
              setPicker(null);
              if (p.kind === "combine" && id)
                void grouping.run((s) => mergeGroups(s, [p.groupId, id]));
              if (p.kind === "move")
                void grouping.run((s) => moveGroup(s, p.groupId, id));
            }}
          />
        ) : null}
      </StickyPanel>

      <section className="rounded-[14px] border border-[#dbe3f7] bg-white px-3 py-1.5">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#dbe3f7] bg-[#f3f6fd] text-left text-[12px] font-semibold text-[#4a5a85]">
              <th className={"w-8 " + STICKY_TH} />
              <SortTh
                className={"px-2 py-1.5 " + STICKY_TH}
                sortKey="name"
                sort={sort}
                onSort={toggleSort}
              >
                {filter === "sin_agrupar" ? "Producto" : "Grupo / producto"}
              </SortTh>
              <SortTh
                className={"px-2 py-1.5 " + STICKY_TH}
                sortKey="sales"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                Ventas
              </SortTh>
              <SortTh
                className={"px-2 py-1.5 " + STICKY_TH}
                sortKey="margin"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                Margen
              </SortTh>
              <SortTh
                className={"px-2 py-1.5 " + STICKY_TH}
                sortKey="cost"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                Costo %
              </SortTh>
              <SortTh
                className={"px-2 py-1.5 " + STICKY_TH}
                sortKey="share"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                % de ventas totales
              </SortTh>
              <th className={"px-2 py-1.5 " + STICKY_TH}>
                {filter === "sin_agrupar" ? "Sugerencia" : ""}
              </th>
              <th className={"w-8 " + STICKY_TH} />
            </tr>
          </thead>
          <tbody>
            {filter === "sin_agrupar"
              ? ungroupedLeaves.slice(0, shownRows).map((leaf) => {
                  const suggestion = suggestionOf(leaf.ref);
                  return (
                    <LeafRow
                      key={leaf.ref}
                      leaf={leaf}
                      depth={0}
                      totalSales={totalSales}
                      money={money}
                      canEdit={canEdit}
                      checked={selected.has(leaf.ref)}
                      onCheck={toggleSelect}
                      suggestion={
                        <SuggestionChip
                          targetName={suggestion?.target.name ?? null}
                          onAccept={() => {
                            if (suggestion)
                              void addRefsTo([leaf.ref], suggestion.target);
                          }}
                        />
                      }
                    />
                  );
                })
              : visibleTop
                  .slice(0, shownRows)
                  .map((node) => (
                    <NodeRows
                      key={node.id}
                      node={node}
                      money={money}
                      canEdit={canEdit}
                      totalSales={totalSales}
                      open={openIds}
                      highlightId={highlightId}
                      onToggle={open.toggle}
                      selected={selected}
                      onCheck={toggleSelect}
                      renaming={renaming}
                      onRenaming={setRenaming}
                      onRename={onRename}
                      onUngroup={onUngroupGroup}
                      onPicker={onPicker}
                      isDish={dishOfNode}
                      onDrill={onDrillNode}
                      onRecipe={onRecipeNode}
                    />
                  ))}
            {(filter === "sin_agrupar"
              ? ungroupedLeaves.length
              : visibleTop.length) === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-[#5b6476]">
                  {filter === "sin_agrupar"
                    ? "Todos los productos están agrupados."
                    : query.trim()
                      ? `Nada coincide con «${query.trim()}».`
                      : "No hay productos con ese filtro."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function collect(nodes: readonly TreeNode[], out: TreeNode[]) {
  for (const n of nodes) {
    out.push(n);
    collect(n.children, out);
  }
}

function leavesUnderAll(top: readonly TreeNode[]): TreeLeaf[] {
  const out: TreeLeaf[] = [];
  for (const n of top) {
    if (n.kind === "leaf" && n.leaf) out.push(n.leaf);
    else out.push(...leavesUnder(n));
  }
  return out;
}

const pctText = (n: number) =>
  `${n.toLocaleString("es", { maximumFractionDigits: 0 })}%`;

/** Share of ALL sales: the same base on every row, parent or child. */
function shareText(sales: number, total: number): string {
  if (!(total > 0)) return "—";
  const v = (sales / total) * 100;
  if (v >= 10) return `${Math.round(v)}%`;
  if (v >= 0.1)
    return `${v.toLocaleString("es", { maximumFractionDigits: 1 })}%`;
  return v > 0 ? "<0,1%" : "0%";
}

function NodeRows(props: {
  node: TreeNode;
  money: (n: number) => string;
  canEdit: boolean;
  totalSales: number;
  open: Set<string>;
  highlightId: string | null;
  onToggle: (id: string) => void;
  selected: Set<string>;
  onCheck: (ref: string) => void;
  renaming: string | null;
  onRenaming: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
  onUngroup: (id: string) => void;
  onPicker: (kind: "combine" | "move", groupId: string) => void;
  isDish: (node: TreeNode) => MenuDish | null;
  onDrill: (node: TreeNode) => void;
  onRecipe: (node: TreeNode) => void;
}) {
  const { node, money, canEdit, totalSales } = props;
  if (node.kind === "leaf" && node.leaf) {
    return (
      <LeafRow
        leaf={node.leaf}
        depth={node.depth}
        totalSales={totalSales}
        money={money}
        canEdit={canEdit}
        checked={props.selected.has(node.leaf.ref)}
        onCheck={props.onCheck}
      />
    );
  }
  const isOpen = props.open.has(node.id);
  const isAuto = node.group?.source === "auto" || node.virtual;
  const stored = !!node.group && !node.virtual;
  const dish = props.isDish(node);
  const r = node.rollup;
  return (
    <>
      <tr
        data-group-id={node.group ? node.id : undefined}
        className={
          "group/row border-b border-[#dbe3f7] font-semibold transition-colors duration-700 " +
          (props.highlightId === node.id
            ? "bg-[#cfdcfa] outline outline-2 -outline-offset-2 outline-[#1b40c8]"
            : "bg-[#eef2fc] hover:bg-[#e6ecfb]")
        }
        onDoubleClick={() => stored && canEdit && props.onRenaming(node.id)}
      >
        <td />
        <td className="px-2 py-2" style={{ paddingLeft: 8 + node.depth * 18 }}>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={isOpen ? "Cerrar grupo" : "Abrir grupo"}
              onClick={() => props.onToggle(node.id)}
              className="text-[#1b40c8]"
            >
              {isOpen ? "▾" : "▸"}
            </button>
            {props.renaming === node.id && node.group ? (
              <input
                autoFocus
                defaultValue={node.name}
                aria-label="Nombre del grupo"
                className="rounded border border-[#1b40c8] px-1.5 py-0.5"
                onBlur={() => props.onRenaming(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") props.onRenaming(null);
                  if (e.key === "Enter" && node.group)
                    props.onRename(node.group.id, e.currentTarget.value);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => props.onDrill(node)}
                className="text-[#151c2c] hover:text-[#1b40c8] hover:underline"
                title="Ver el desglose"
              >
                {node.name}
              </button>
            )}
            <span className="text-[12px] font-normal text-[#6b7a9e]">
              {r.row_count} {r.row_count === 1 ? "producto" : "productos"}
              {isAuto ? " · plato del menú" : ""}
            </span>
            {node.group?.source === "ai_suggested" ? <MiltonMark /> : null}
            {canEdit && stored ? (
              <button
                type="button"
                aria-label={`Renombrar ${node.name}`}
                title="Renombrar"
                onClick={() => props.onRenaming(node.id)}
                className="rounded p-0.5 text-[#6b7a9e] opacity-0 hover:text-[#1b40c8] focus:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            <span className="pl-1 font-normal">
              <RowActions
                onDrill={() => props.onDrill(node)}
                onRecipe={
                  dish?.base_odoo_product_id != null
                    ? () => props.onRecipe(node)
                    : undefined
                }
              />
            </span>
          </div>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {money(r.net_sales)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{marginLabel(r)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{costPctLabel(r)}</td>
        <td className="px-2 py-2 text-right tabular-nums">
          {shareText(r.net_sales, totalSales)}
        </td>
        <td />
        <td className="px-1 py-2 text-right">
          {canEdit && stored ? (
            <GroupMenu
              isAuto={isAuto}
              onRename={() => props.onRenaming(node.id)}
              onMove={() => props.onPicker("move", node.group!.id)}
              onCombine={() => props.onPicker("combine", node.group!.id)}
              onUngroup={() => props.onUngroup(node.group!.id)}
            />
          ) : null}
        </td>
      </tr>
      {isOpen
        ? node.children.map((c) => <NodeRows key={c.id} {...props} node={c} />)
        : null}
    </>
  );
}

const LeafRow = memo(function LeafRow({
  leaf,
  depth,
  totalSales,
  money,
  canEdit,
  checked,
  onCheck,
  suggestion,
}: {
  leaf: TreeLeaf;
  depth: number;
  totalSales: number;
  money: (n: number) => string;
  canEdit: boolean;
  checked: boolean;
  onCheck: (ref: string) => void;
  suggestion?: React.ReactNode;
}) {
  const known = leaf.cost_total !== null && leaf.net_sales > 0;
  const margin = known
    ? pctText(((leaf.net_sales - leaf.cost_total!) / leaf.net_sales) * 100)
    : "Sin precio";
  const cost = known
    ? pctText((leaf.cost_total! / leaf.net_sales) * 100)
    : "Sin precio";
  return (
    <tr
      className={
        "border-b border-[#eef0f4] " +
        (checked ? "bg-[#e6ecfb]" : "hover:bg-[#f7f9fe]")
      }
      data-testid="producto-row"
    >
      <td className="px-2 py-2 text-center">
        {canEdit ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onCheck(leaf.ref)}
            aria-label={`Seleccionar ${leaf.name}`}
            className="accent-[#1b40c8]"
          />
        ) : null}
      </td>
      <td className="px-2 py-2" style={{ paddingLeft: 8 + depth * 18 }}>
        {leaf.name}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {money(leaf.net_sales)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{margin}</td>
      <td className="px-2 py-2 text-right tabular-nums">{cost}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {shareText(leaf.net_sales, totalSales)}
      </td>
      <td className="px-2 py-2">{suggestion}</td>
      <td />
    </tr>
  );
});
