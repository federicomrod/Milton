"use client";

// R1-15c: Preparaciones and Ingredientes share this list: the Todos /
// Agrupados / Sin agrupar filter, groups with their items under them, a
// checkbox per row, per-row suggestion (heuristics only) in "Sin agrupar",
// and the dark action bar. The screens give the rows; no cost or price is
// computed here.

import { NOT_AVAILABLE_YET } from "@/lib/restaurant/ui-copy";
import { useMemo, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
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
import { MiltonMark, MiltonSuggestions } from "./MiltonSuggestions";
import { useMiltonSuggestions } from "./use-milton-suggestions";
import { SearchBox } from "@/components/restaurant/ui/SearchBox";
import { useProgressiveCount } from "./use-progressive";
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

export interface GroupedItemListProps<T extends GroupableItem> {
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
  /** Category of an item, for Milton's suggestions (names and categories only). */
  categoryOf?: (item: T) => string | null | undefined;
  /** The screen's own filters (uso, falta precio…): drawn in the toolbar, between the grouping tabs and the sort chips. */
  filters?: ReactNode;
  /** Ingredientes: «Unir…» in the selection bar when 2+ rows are selected. */
  onMergeSelected?: (ids: string[], clearSelection: () => void) => void;
}

/**
 * The list split in two so a screen can put the toolbar (search, Milton's
 * suggestions, the Todos / Agrupados / Sin agrupar tabs and the selection
 * actions, the screen's filters, the sort chips) full width ABOVE its
 * list + detail grid, and only the rows in the list column. One hook = one
 * source of state (query, filter, sort, selection, Milton's preview).
 */
export function useGroupedItemList<T extends GroupableItem>({
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
  categoryOf,
  filters,
  onMergeSelected,
}: GroupedItemListProps<T>) {
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

  // Milton's suggestions for the items in no group.
  const miltonItems = useMemo(
    () =>
      ungrouped.map((i) => ({
        ref: i.id,
        name: i.name,
        category: categoryOf?.(i) ?? null,
      })),
    [ungrouped, categoryOf]
  );
  const miltonTaken = useMemo(
    () =>
      grouping.state.groups.filter((g) => g.scope === scope).map((g) => g.name),
    [grouping.state.groups, scope]
  );
  const milton = useMiltonSuggestions({
    scope,
    grouping,
    ungrouped: miltonItems,
    takenNames: miltonTaken,
    enabled: canEdit && grouping.available,
  });

  // Only what is on screen can be selected, acted on or counted.
  const visibleIds = new Set<string>();
  const walkVisible = (g: StoredItemGroup, all: boolean) => {
    if (!groupVisible(g)) return;
    const every = all || (!!q && foldText(g.name).includes(q));
    if (!q && !open.set.has(g.id)) return;
    (children.get(g.id) ?? []).forEach((c) => walkVisible(c, every));
    (itemsIn.get(g.id) ?? [])
      .filter((item) => every || matches(item))
      .forEach((item) => visibleIds.add(item.id));
  };
  if (filter !== "sin_agrupar")
    (children.get(null) ?? []).forEach((g) => walkVisible(g, false));
  if (filter !== "agrupados")
    ungrouped
      .filter(
        (i) =>
          matches(i) && (!milton.previewRefs || milton.previewRefs.has(i.id))
      )
      .forEach((item) => visibleIds.add(item.id));
  const selectedIds = [...selected].filter((id) => visibleIds.has(id));
  const shared = sharedSuggestion(suggestions, selectedIds);

  const row = (item: T, suggestion?: ReactNode) => (
    <div key={item.id} className="flex items-center gap-1.5">
      {canEdit ? (
        <input
          type="checkbox"
          checked={selected.has(item.id)}
          onChange={() => toggle(item.id)}
          aria-label={`Seleccionar ${item.name}`}
          className="accent-[#1b40c8]"
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
            "group/row flex items-center gap-1 border-b border-slate-100 px-1 py-1.5 text-xs font-semibold transition-colors duration-700 " +
            (highlightId === g.id
              ? "bg-[#cfdcfa] ring-2 ring-[#1b40c8]"
              : "bg-[#eef2fc]")
          }
          onDoubleClick={() => canEdit && setRenaming(g.id)}
        >
          <button
            type="button"
            aria-label={isOpen ? "Cerrar grupo" : "Abrir grupo"}
            onClick={() => open.toggle(g.id)}
            className="text-[#1b40c8]"
          >
            {isOpen ? "▾" : "▸"}
          </button>
          {renaming === g.id ? (
            <input
              autoFocus
              defaultValue={g.name}
              aria-label="Nombre del grupo"
              className="min-w-0 flex-1 rounded border border-[#1b40c8] px-1.5 py-0.5"
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
            <span className="flex-1">
              {g.name}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={`Renombrar ${g.name}`}
                  title="Renombrar"
                  onClick={() => setRenaming(g.id)}
                  className="ml-1.5 rounded p-0.5 align-middle text-[#6b7a9e] opacity-0 hover:text-[#1b40c8] focus:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <Pencil className="inline h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </span>
          )}
          {g.source === "ai_suggested" ? <MiltonMark /> : null}
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
  const topItems =
    filter !== "agrupados"
      ? ungrouped.filter(
          (i) =>
            matches(i) && (!milton.previewRefs || milton.previewRefs.has(i.id))
        )
      : [];
  const shownItems = useProgressiveCount(
    topItems.length,
    `${filter}|${query}|${sort?.key}|${sort?.dir}`
  );
  const nothingShown = topGroups.length + topItems.length === 0;

  const toolbar = (
    <>
      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder={searchPlaceholder}
        className="max-w-md"
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
          onApply={(c) => void milton.apply(c)}
          onDismiss={(c) => void milton.dismiss(c)}
          onEndPreview={milton.endPreview}
          onAskAi={() => void milton.askAi()}
          aiBusy={milton.aiBusy}
          canAskAi={milton.canAskAi}
          itemWord={scope === "ingredient" ? "ingredientes" : "preparaciones"}
        />
      ) : null}
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
        onMerge={
          onMergeSelected && canEdit && selectedIds.length >= 2
            ? () => onMergeSelected(selectedIds, clear)
            : undefined
        }
        onAcceptShared={() => shared && void addTo(selectedIds, shared.id)}
        onClearSelection={clear}
        defaultNewName={byId.get(selectedIds[0] ?? "")?.name}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {filters}
        <SortChips columns={sortColumns} sort={sort} onSort={toggleSort} />
      </div>
    </>
  );

  const list = (
    <div data-testid="grouped-item-list-rows">
      {!grouping.available ? (
        <p className="mb-2 rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-2 py-1 text-xs">
          {NOT_AVAILABLE_YET}
        </p>
      ) : null}
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
          ? sortedItems(topItems)
              .slice(0, shownItems)
              .map((item) =>
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

  return { toolbar, list };
}

/** The list as before: toolbar and rows together (a sticky header over the rows). */
export function GroupedItemList<T extends GroupableItem>(
  props: GroupedItemListProps<T>
) {
  const { toolbar, list } = useGroupedItemList(props);
  return (
    <div className="space-y-2" data-testid="grouped-item-list">
      <div className="sticky top-0 z-10 -mx-2 -mt-2 space-y-2 bg-white px-2 pb-2 pt-2">
        {toolbar}
      </div>
      {list}
    </div>
  );
}
