"use client";

// R1-15c: filter + dark action bar + popovers + toast, as ONE piece that
// Platos (productos), Preparaciones and Ingredientes all render at the top.
// It owns the popover state; the screens own their rows and what "add" means
// (a group of the person, or a menu dish).

import { useState } from "react";
import {
  GroupActionBar,
  GroupAsPopover,
  GroupPicker,
  GroupToastView,
  GroupingFilter,
  type GroupOption,
  type GroupingFilterValue,
} from "./GroupingControls";
import type { useItemGroups } from "./use-item-groups";

export interface ToolbarTarget {
  id: string;
  name: string;
}

export function GroupingToolbar({
  grouping,
  filter,
  onFilter,
  counts,
  note,
  selectedCount,
  selectionSummary,
  sharedSuggestion,
  anySelectedGrouped,
  /** Every place an item can go (groups of the person, and menu dishes in Platos). */
  pickerOptions,
  /** Places a NEW group can go inside (groups of the person only). */
  parentOptions,
  onAddToExisting,
  onGroupAs,
  onUngroup,
  onMerge,
  onAcceptShared,
  onClearSelection,
  defaultNewName,
  selectionNote,
  duplicateHint,
  onDuplicateGroup,
}: {
  grouping: ReturnType<typeof useItemGroups>;
  filter: GroupingFilterValue;
  onFilter: (next: GroupingFilterValue) => void;
  counts: { all: number; grouped: number; ungrouped: number };
  note?: string | null;
  selectedCount: number;
  selectionSummary?: string | null;
  sharedSuggestion: ToolbarTarget | null;
  anySelectedGrouped: boolean;
  pickerOptions: readonly (GroupOption & { kind?: "dish" | "group" })[];
  parentOptions: readonly GroupOption[];
  onAddToExisting: (target: GroupOption & { kind?: "dish" | "group" }) => void;
  onGroupAs: (name: string, parentId: string | null) => void;
  onUngroup: () => void;
  onMerge?: () => void;
  onAcceptShared: () => void;
  onClearSelection: () => void;
  defaultNewName?: string;
  /** e.g. "La selección mezcla restaurantes: el grupo será compartido." */
  selectionNote?: string | null;
  /** Same-restaurant products with the same or near-same name. */
  duplicateHint?: { name: string; refs: string[] } | null;
  onDuplicateGroup?: (name: string, refs: string[]) => void;
}) {
  const [panel, setPanel] = useState<"picker" | "groupAs" | null>(null);
  return (
    <div className="space-y-3">
      <GroupingFilter
        value={filter}
        onChange={onFilter}
        counts={counts}
        note={note}
      />
      <GroupActionBar
        count={selectedCount}
        summary={selectionSummary}
        suggestionName={sharedSuggestion?.name ?? null}
        canUngroup={anySelectedGrouped}
        onAcceptSuggestion={onAcceptShared}
        onAddToExisting={() => setPanel("picker")}
        onGroupAs={() => setPanel("groupAs")}
        onUngroup={onUngroup}
        onMerge={onMerge}
        onClear={onClearSelection}
      />
      {selectedCount > 0 && selectionNote ? (
        <p className="text-[12px] text-[#a35a00]">{selectionNote}</p>
      ) : null}
      {selectedCount > 0 && duplicateHint && onDuplicateGroup ? (
        <button
          type="button"
          onClick={() =>
            onDuplicateGroup(duplicateHint.name, duplicateHint.refs)
          }
          className="rounded-lg border border-dashed border-[#1b40c8] bg-white px-3 py-1 text-[12px] font-semibold text-[#1b40c8] hover:bg-[#e6ecfb]"
        >
          ✦ ¿Parecen duplicados? Agrupar como «{duplicateHint.name}»
        </button>
      ) : null}
      {panel === "picker" ? (
        <GroupPicker
          title="Añadir a grupo existente"
          options={pickerOptions}
          onCancel={() => setPanel(null)}
          onPick={(id) => {
            const target = pickerOptions.find((o) => o.id === id);
            setPanel(null);
            if (target) onAddToExisting(target);
          }}
        />
      ) : null}
      {panel === "groupAs" ? (
        <GroupAsPopover
          parents={parentOptions}
          initialName={defaultNewName}
          onCancel={() => setPanel(null)}
          onCreate={(name, parentId) => {
            setPanel(null);
            onGroupAs(name, parentId);
          }}
        />
      ) : null}
      <GroupToastView
        toast={grouping.toast}
        onDismiss={grouping.dismissToast}
      />
    </div>
  );
}
