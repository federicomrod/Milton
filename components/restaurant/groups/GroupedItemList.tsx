"use client";

// R1-15c: Preparaciones and Ingredientes share this list: the Todos /
// Agrupados / Sin agrupar filter, groups with their items under them, a
// checkbox per row, per-row suggestion (heuristics only) in "Sin agrupar",
// and the dark action bar. The screens give the rows; no cost or price is
// computed here.

import { useMemo, useState, type ReactNode } from "react";
import {
  addToGroup,
  createGroup,
  groupPath,
  mergeGroups,
  moveGroup,
  removeFromGroups,
  renameGroup,
  ungroupGroup,
} from "@/lib/restaurant/groups/group-ops";
import type {
  GroupMemberType,
  StoredItemGroup,
} from "@/lib/restaurant/groups/item-groups";
import {
  sharedSuggestion,
  suggestGroup,
  type Suggestion,
  type SuggestTarget,
} from "@/lib/restaurant/groups/suggest";
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
import { SortChips } from "@/components/restaurant/sort/SortTh";
import { useTableSort } from "@/components/restaurant/sort/use-table-sort";
import { foldText } from "@/lib/restaurant/groups/search";
import { sortRows, type SortValue } from "@/lib/restaurant/table-sort";

export interface GroupableItem {
  id: string;
  name: string;
}

export interface SortColumn<T> {
  key: string;
  label: string;
  value: (item: T) => SortValue;
  /** How a group is ranked among groups: the sum or the highest of its items (default: highest). */
  agg?: "sum" | "max";
}

const uuid = () => crypto.randomUUID();

export function GroupedItemList<T extends GroupableItem>({
  items,
  scope,
  grouping,
  canEdit,
  storageKey,
  renderRow,
  emptyText,
  sortId,
  sortColumns,
  searchPlaceholder = "Buscar…",
  searchText,
}: {
  items: readonly T[];
  scope: "preparation" | "ingredient";
  grouping: ReturnType<typeof useItemGroups>;
  canEdit: boolean;
  storageKey: string;
  renderRow: (item: T) => ReactNode;
  emptyText: string;
  /** Remembered for the session, per table. */
  sortId: string;
  sortColumns: ReadonlyArray<SortColumn<T>>;
  searchPlaceholder?: string;
  /** Extra text an item is found by (supplier…). */
  searchText?: (item: T) => string | null | undefined;
}) {
  const memberType: GroupMemberType = scope;
  const hierarchy = { scope } as const;
  const [filter, setFilter] = useState<GroupingFilterValue>("todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picker, setPicker] = useState<{
    kind: "combine" | "move";
    groupId: string;
  } | null>(null);
  const open = useRememberedSet(storageKey);
  const [query, setQuery] = useState("");
  const { sort, toggle: toggleSort } = useTableSort(sortId);
  const highlightId = useGroupFocus(grouping, open, () => {
    setQuery("");
    setFilter((f) => (f === "sin_agrupar" ? "agrupados" : f));
  });
  const q = foldText(query);
  const column = sortColumns.find((c) => c.key === sort?.key) ?? null;
  const itemValue = (item: T): SortValue =>
    column ? column.value(item) : null;
  const matches = (item: T) =>
    !q ||
    foldText(item.name).includes(q) ||
    foldText(searchText?.(item) ?? "").includes(q);

  const groups = useMemo(
    () =>
      grouping.state.groups.filter(
        (g) => g.scope === scope && g.status === "confirmed"
      ),
    [grouping.state.groups, scope]
  );
  const groupIds = useMemo(() => new Set(groups.map((g) => g.id)), [groups]);
  const groupOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of grouping.state.members) {
      if (mem.member_type === memberType && groupIds.has(mem.group_id)) {
        m.set(mem.member_ref, mem.group_id);
      }
    }
    return m;
  }, [grouping.state.members, memberType, groupIds]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const ungrouped = useMemo(
    () => items.filter((i) => !groupOf.has(i.id)),
    [items, groupOf]
  );
  // Agrupados + Sin agrupar = Todos, whatever the groups hold.
  const counts = {
    all: items.length,
    grouped: items.length - ungrouped.length,
    ungrouped: ungrouped.length,
  };

  const options: GroupOption[] = useMemo(
    () =>
      groups
        .map((g) => ({
          id: g.id,
          name: g.name,
          path: groupPath(grouping.state, g.id),
        }))
        .sort((a, b) => a.path.localeCompare(b.path, "es")),
    [groups, grouping.state]
  );

  const suggestions = useMemo(() => {
    const names = new Map<string, string[]>();
    for (const [ref, gid] of groupOf) {
      const item = byId.get(ref);
      if (item) names.set(gid, [...(names.get(gid) ?? []), item.name]);
    }
    const targets: SuggestTarget[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      kind: "group",
      memberNames: names.get(g.id) ?? [],
    }));
    const out = new Map<string, Suggestion | null>();
    for (const item of ungrouped)
      out.set(item.id, suggestGroup(item.name, targets));
    return out;
  }, [groups, groupOf, byId, ungrouped]);

  const selectedIds = [...selected].filter((id) => byId.has(id));
  const shared = sharedSuggestion(suggestions, selectedIds);
  const clear = () => setSelected(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const refs = (ids: readonly string[]) =>
    ids.map((ref) => ({ type: memberType, ref }));

  async function addTo(ids: readonly string[], groupId: string) {
    clear();
    await grouping.run((s) =>
      addToGroup(s, { groupId, items: refs(ids), uuid })
    );
  }

  const children = useMemo(() => {
    const m = new Map<string | null, StoredItemGroup[]>();
    for (const g of groups) {
      const parent =
        g.parent_id && groupIds.has(g.parent_id) ? g.parent_id : null;
      m.set(parent, [...(m.get(parent) ?? []), g]);
    }
    for (const list of m.values())
      list.sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name, "es")
      );
    return m;
  }, [groups, groupIds]);
  const itemsIn = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const item of items) {
      const g = groupOf.get(item.id);
      if (g) m.set(g, [...(m.get(g) ?? []), item]);
    }
    return m;
  }, [items, groupOf]);
  const countUnder = (g: StoredItemGroup): number =>
    (itemsIn.get(g.id)?.length ?? 0) +
    (children.get(g.id) ?? []).reduce((s, c) => s + countUnder(c), 0);

  const itemsUnder = (g: StoredItemGroup): T[] => [
    ...(itemsIn.get(g.id) ?? []),
    ...(children.get(g.id) ?? []).flatMap(itemsUnder),
  ];
  const groupRank = (g: StoredItemGroup): SortValue => {
    if (!sort) return null;
    if (sort.key === "name") return g.name;
    if (!column) return null;
    const values = itemsUnder(g)
      .map(itemValue)
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) return null;
    return column.agg === "sum"
      ? values.reduce((a, b) => a + b, 0)
      : Math.max(...values);
  };
  const sortedItems = (list: readonly T[]) =>
    sortRows(list, sort, (item, key) =>
      key === "name" ? item.name : itemValue(item)
    );
  const sortedGroups = (list: readonly StoredItemGroup[]) =>
    sortRows(list, sort, (g) => groupRank(g));
  /** Group name matches (it or an ancestor) = every member shows. */
  const groupVisible = (g: StoredItemGroup): boolean =>
    !q ||
    foldText(g.name).includes(q) ||
    (itemsIn.get(g.id) ?? []).some(matches) ||
    (children.get(g.id) ?? []).some(groupVisible);

  const row = (item: T, suggestion?: ReactNode) => (
    <div key={item.id} className="flex items-center gap-1.5">
      {canEdit ? (
        <input
          type="checkbox"
          checked={selected.has(item.id)}
          onChange={() => toggle(item.id)}
          aria-label={`Seleccionar ${item.name}`}
        />
      ) : null}
      <div className="min-w-0 flex-1">{renderRow(item)}</div>
      {suggestion}
    </div>
  );

  const renderGroup = (
    g: StoredItemGroup,
    depth: number,
    allShown = false
  ): ReactNode => {
    if (!groupVisible(g)) return null;
    const nameHit = !!q && foldText(g.name).includes(q);
    const everything = allShown || nameHit;
    const isOpen = !!q || open.set.has(g.id);
    return (
      <div key={g.id} style={{ marginLeft: depth * 12 }}>
        <div
          data-group-id={g.id}
          className={
            "flex items-center gap-1 border-b border-slate-100 px-1 py-1.5 text-xs font-semibold transition-colors duration-700 " +
            (highlightId === g.id
              ? "bg-[#ffe9c2] ring-2 ring-[#f28c28]"
              : "bg-[#fafbfc]")
          }
          onDoubleClick={() => canEdit && setRenaming(g.id)}
        >
          <button
            type="button"
            aria-label={isOpen ? "Cerrar grupo" : "Abrir grupo"}
            onClick={() => open.toggle(g.id)}
            className="text-[#5b6476]"
          >
            {isOpen ? "▾" : "▸"}
          </button>
          {renaming === g.id ? (
            <input
              autoFocus
              defaultValue={g.name}
              aria-label="Nombre del grupo"
              className="min-w-0 flex-1 rounded border border-[#f28c28] px-1.5 py-0.5"
              onBlur={() => setRenaming(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setRenaming(null);
                if (e.key === "Enter") {
                  const name = e.currentTarget.value;
                  setRenaming(null);
                  void grouping.run((s) => renameGroup(s, g.id, name));
                }
              }}
            />
          ) : (
            <span className="flex-1">{g.name}</span>
          )}
          <span className="font-normal text-[#8a92a3]">{countUnder(g)}</span>
          {canEdit ? (
            <GroupMenu
              isAuto={false}
              onRename={() => setRenaming(g.id)}
              onMove={() => setPicker({ kind: "move", groupId: g.id })}
              onCombine={() => setPicker({ kind: "combine", groupId: g.id })}
              onUngroup={() => void grouping.run((s) => ungroupGroup(s, g.id))}
            />
          ) : null}
        </div>
        {isOpen ? (
          <>
            {sortedGroups(children.get(g.id) ?? []).map((c) =>
              renderGroup(c, depth + 1, everything)
            )}
            {sortedItems(itemsIn.get(g.id) ?? [])
              .filter((item) => everything || matches(item))
              .map((item) => row(item))}
          </>
        ) : null}
      </div>
    );
  };

  const topGroups =
    filter !== "sin_agrupar"
      ? (children.get(null) ?? []).filter(groupVisible)
      : [];
  const topItems = filter !== "agrupados" ? ungrouped.filter(matches) : [];
  const nothingShown = topGroups.length + topItems.length === 0;

  return (
    <div className="space-y-2" data-testid="grouped-item-list">
      {!grouping.available ? (
        <p className="rounded-md border border-[#f5c98b] bg-[#fff8ec] px-2 py-1 text-xs">
          Para agrupar falta aplicar las migraciones 048 y 049 en este ambiente.
        </p>
      ) : null}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="h-9 w-full rounded-lg border border-[#e3e7ee] bg-white px-3 text-[13px] text-[#151c2c] outline-none focus:border-[#f28c28]"
      />
      <SortChips columns={sortColumns} sort={sort} onSort={toggleSort} />
      <GroupingToolbar
        grouping={grouping}
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        selectedCount={canEdit ? selectedIds.length : 0}
        sharedSuggestion={shared}
        anySelectedGrouped={selectedIds.some((id) => groupOf.has(id))}
        pickerOptions={options}
        parentOptions={options}
        onAddToExisting={(t) => void addTo(selectedIds, t.id)}
        onGroupAs={(name, parentId) => {
          const ids = selectedIds;
          clear();
          void grouping.run((s) =>
            createGroup(s, {
              name,
              hierarchy,
              parentId,
              items: refs(ids),
              uuid,
            })
          );
        }}
        onUngroup={() => {
          const ids = selectedIds;
          clear();
          void grouping.run((s) => removeFromGroups(s, { items: refs(ids) }));
        }}
        onAcceptShared={() => shared && void addTo(selectedIds, shared.id)}
        onClearSelection={clear}
        defaultNewName={byId.get(selectedIds[0] ?? "")?.name}
      />
      {picker ? (
        <GroupPicker
          title={
            picker.kind === "combine"
              ? "Combinar con…"
              : "Mover el grupo dentro de…"
          }
          allowTop={picker.kind === "move"}
          options={options.filter((o) => o.id !== picker.groupId)}
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
      <div>
        {filter !== "sin_agrupar"
          ? sortedGroups(children.get(null) ?? []).map((g) => renderGroup(g, 0))
          : null}
        {filter !== "agrupados"
          ? sortedItems(ungrouped.filter(matches)).map((item) =>
              row(
                item,
                filter === "sin_agrupar" ? (
                  <SuggestionChip
                    targetName={suggestions.get(item.id)?.target.name ?? null}
                    onAccept={() => {
                      const t = suggestions.get(item.id)?.target;
                      if (t) void addTo([item.id], t.id);
                    }}
                  />
                ) : undefined
              )
            )
          : null}
        {nothingShown ? (
          <p className="px-2 py-3 text-xs text-[#5b6476]">
            {q ? `Nada coincide con «${query.trim()}».` : emptyText}
          </p>
        ) : null}
      </div>
    </div>
  );
}
