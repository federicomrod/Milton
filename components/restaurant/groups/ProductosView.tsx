"use client";

// R1-15c (mocks 7 and 9): Platos › Productos. Every POS product on one list,
// grouped under the person's groups and the Plato del menú level, with the
// Todos / Agrupados / Sin agrupar filter, multi-select and the dark action
// bar. Every figure is the roll-up of costing/rollup.ts; this file only
// arranges rows and calls the pure actions of group-ops.

import { useMemo, useState } from "react";
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
      return node.share_pct;
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
}: {
  dishes: readonly MenuDish[];
  excluded: readonly MenuDish[];
  grouping: ReturnType<typeof useItemGroups>;
  canEdit: boolean;
  money: (n: number) => string;
  /** Add products to a menu dish: the same "mover variante" as the Platos view. */
  onAddToDish: (productIds: number[], dish: MenuDish) => void;
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
          g.status === "confirmed"
      ),
    [grouping.state.groups]
  );
  const groupOptions: GroupOption[] = useMemo(
    () =>
      userGroups
        .map((g) => ({
          id: g.id,
          name: g.name,
          path: groupPath(grouping.state, g.id),
        }))
        .sort((a, b) => a.path.localeCompare(b.path, "es")),
    [userGroups, grouping.state]
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

  // Suggestions: heuristics only, for the products with no group.
  const suggestions = useMemo(() => {
    const targets: SuggestTarget[] = [
      ...dishes.map(
        (d): SuggestTarget => ({ id: d.id, name: d.name, kind: "dish" })
      ),
    ];
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
    const out = new Map<string, Suggestion | null>();
    for (const ref of ungroupedRefs) {
      const leaf = leafByRef.get(ref);
      if (leaf) out.set(ref, suggestGroup(leaf.name, targets));
    }
    return out;
  }, [dishes, tree, ungroupedRefs, leafByRef]);

  const selectedRefs = [...selected].filter((r) => leafByRef.has(r));
  const shared = sharedSuggestion(suggestions, selectedRefs);
  const selectedSales = selectedRefs.reduce(
    (s, r) => s + (leafByRef.get(r)?.net_sales ?? 0),
    0
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
  const toggleSelect = (ref: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });

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

  async function groupAs(name: string, parentId: string | null) {
    const { items, dishRefs } = split(selectedRefs);
    clear();
    await grouping.run((s) =>
      createGroup(s, {
        name,
        hierarchy: HIERARCHY,
        parentId,
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
    return sortRows(list, sort, leafValue);
  }, [tree.ungrouped, query, sort]);

  const note =
    counts.ungrouped > 0 && counts.share !== null
      ? `${money(counts.sales)} en ventas sin agrupar · ${counts.share.toLocaleString("es", { maximumFractionDigits: 1 })}%`
      : null;

  const parentOptions = groupOptions;

  return (
    <div className="space-y-3" data-testid="productos-view">
      {!grouping.available ? (
        <p className="rounded-lg border border-[#f5c98b] bg-[#fff8ec] px-3 py-2 text-[13px]">
          Para agrupar falta aplicar las migraciones 048 y 049 en este ambiente.
          Mientras tanto puedes ver los productos, no guardar grupos.
        </p>
      ) : null}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar producto o grupo…"
        aria-label="Buscar producto o grupo"
        className="h-9 w-full max-w-md rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] text-[#151c2c] outline-none focus:border-[#f28c28]"
      />
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

      <section className="rounded-[14px] border border-[#eef0f4] bg-white px-3 py-1.5">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#eef0f4] text-left text-[12px] font-semibold text-[#8a92a3]">
              <th className="w-8" />
              <SortTh sortKey="name" sort={sort} onSort={toggleSort}>
                {filter === "sin_agrupar" ? "Producto" : "Grupo / producto"}
              </SortTh>
              <SortTh
                sortKey="sales"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                Ventas
              </SortTh>
              <SortTh
                sortKey="margin"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                Margen
              </SortTh>
              <SortTh
                sortKey="cost"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                Costo %
              </SortTh>
              <SortTh
                sortKey="share"
                sort={sort}
                onSort={toggleSort}
                align="right"
              >
                % del total
              </SortTh>
              <th className="px-2 py-1.5">
                {filter === "sin_agrupar" ? "Sugerencia" : ""}
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filter === "sin_agrupar"
              ? ungroupedLeaves.map((leaf) => (
                  <LeafRow
                    key={leaf.ref}
                    leaf={leaf}
                    depth={0}
                    share={null}
                    money={money}
                    canEdit={canEdit}
                    checked={selected.has(leaf.ref)}
                    onCheck={() => toggleSelect(leaf.ref)}
                    suggestion={
                      <SuggestionChip
                        targetName={
                          suggestions.get(leaf.ref)?.target.name ?? null
                        }
                        onAccept={() => {
                          const t = suggestions.get(leaf.ref)?.target;
                          if (t) void addRefsTo([leaf.ref], t);
                        }}
                      />
                    }
                  />
                ))
              : visibleTop.map((node) => (
                  <NodeRows
                    key={node.id}
                    node={node}
                    money={money}
                    canEdit={canEdit}
                    open={openIds}
                    highlightId={highlightId}
                    onToggle={open.toggle}
                    selected={selected}
                    onCheck={toggleSelect}
                    renaming={renaming}
                    onRenaming={setRenaming}
                    onRename={(id, name) => {
                      setRenaming(null);
                      void grouping.run((s) => renameGroup(s, id, name));
                    }}
                    onUngroup={(id) =>
                      void grouping.run((s) => ungroupGroup(s, id))
                    }
                    onPicker={(kind, groupId) => setPicker({ kind, groupId })}
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

function NodeRows(props: {
  node: TreeNode;
  money: (n: number) => string;
  canEdit: boolean;
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
}) {
  const { node, money, canEdit } = props;
  if (node.kind === "leaf" && node.leaf) {
    return (
      <LeafRow
        leaf={node.leaf}
        depth={node.depth}
        share={node.share_pct}
        money={money}
        canEdit={canEdit}
        checked={props.selected.has(node.leaf.ref)}
        onCheck={() => props.onCheck(node.leaf!.ref)}
      />
    );
  }
  const isOpen = props.open.has(node.id);
  const isAuto = node.group?.source === "auto" || node.virtual;
  const stored = !!node.group && !node.virtual;
  const r = node.rollup;
  return (
    <>
      <tr
        data-group-id={node.group ? node.id : undefined}
        className={
          "border-b border-[#f2f3f6] font-semibold transition-colors duration-700 " +
          (props.highlightId === node.id
            ? "bg-[#ffe9c2] outline outline-2 -outline-offset-2 outline-[#f28c28]"
            : "bg-[#fafbfc]")
        }
        onDoubleClick={() => stored && canEdit && props.onRenaming(node.id)}
      >
        <td />
        <td className="px-2 py-2" style={{ paddingLeft: 8 + node.depth * 18 }}>
          <button
            type="button"
            aria-label={isOpen ? "Cerrar grupo" : "Abrir grupo"}
            onClick={() => props.onToggle(node.id)}
            className="mr-1 text-[#5b6476]"
          >
            {isOpen ? "▾" : "▸"}
          </button>
          {props.renaming === node.id && node.group ? (
            <input
              autoFocus
              defaultValue={node.name}
              aria-label="Nombre del grupo"
              className="rounded border border-[#f28c28] px-1.5 py-0.5"
              onBlur={() => props.onRenaming(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") props.onRenaming(null);
                if (e.key === "Enter" && node.group)
                  props.onRename(node.group.id, e.currentTarget.value);
              }}
            />
          ) : (
            <span>{node.name}</span>
          )}{" "}
          <span className="text-[12px] font-normal text-[#8a92a3]">
            {r.row_count} {r.row_count === 1 ? "producto" : "productos"}
            {isAuto ? " · plato del menú" : ""}
          </span>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">
          {money(r.net_sales)}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{marginLabel(r)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{costPctLabel(r)}</td>
        <td className="px-2 py-2 text-right tabular-nums">
          {pctText(node.share_pct)}
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

function LeafRow({
  leaf,
  depth,
  share,
  money,
  canEdit,
  checked,
  onCheck,
  suggestion,
}: {
  leaf: TreeLeaf;
  depth: number;
  share: number | null;
  money: (n: number) => string;
  canEdit: boolean;
  checked: boolean;
  onCheck: () => void;
  suggestion?: React.ReactNode;
}) {
  const margin =
    leaf.cost_total === null || leaf.net_sales <= 0
      ? "Sin precio"
      : pctText(((leaf.net_sales - leaf.cost_total) / leaf.net_sales) * 100);
  const cost =
    leaf.cost_total === null || leaf.net_sales <= 0
      ? "Sin precio"
      : pctText((leaf.cost_total / leaf.net_sales) * 100);
  return (
    <tr
      className={"border-b border-[#f2f3f6] " + (checked ? "bg-[#fff8ec]" : "")}
      data-testid="producto-row"
    >
      <td className="px-2 py-2 text-center">
        {canEdit ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            aria-label={`Seleccionar ${leaf.name}`}
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
        {share === null ? "" : pctText(share)}
      </td>
      <td className="px-2 py-2">{suggestion}</td>
      <td />
    </tr>
  );
}
