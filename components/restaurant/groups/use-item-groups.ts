"use client";

// R1-15c: the groups on screen. Every action is applied at once (pure
// group-ops), saved in one transaction in the background, rolled back with a
// message if the save fails, and offered as "Deshacer" for a few seconds.
// Nothing here recalculates a number: sums come from costing/rollup.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GroupOpError,
  applyOps,
  type GroupOps,
  type GroupsState,
  type OpResult,
} from "@/lib/restaurant/groups/group-ops";
import type { ItemGroupsLoad } from "@/lib/restaurant/groups/item-groups";

export interface GroupToast {
  message: string;
  /** Present while "Deshacer" is on offer. */
  undo: (() => void) | null;
  error?: boolean;
}

const UNDO_MS = 8000;

async function save(ops: GroupOps): Promise<void> {
  const res = await fetch("/api/restaurant/item-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops }),
  });
  if (res.ok) return;
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(json.error ?? "No pude guardar la agrupación.");
}

export function useItemGroups(initial: ItemGroupsLoad | null | undefined) {
  const available = initial?.available === true;
  const [state, setState] = useState<GroupsState>({
    groups: initial?.groups ?? [],
    members: initial?.members ?? [],
  });
  const stateRef = useRef(state);
  const pending = useRef(0);
  const [toast, setToast] = useState<GroupToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: GroupsState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // A fresh server copy replaces ours only when nothing is being saved.
  useEffect(() => {
    if (!initial || pending.current > 0) return;
    commit({ groups: initial.groups, members: initial.members });
  }, [initial, commit]);

  const showToast = useCallback((next: GroupToast | null) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    if (next && !next.error) {
      timer.current = setTimeout(() => setToast(null), UNDO_MS);
    }
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const apply = useCallback(
    async (ops: GroupOps, undoOps: GroupOps | null, label: string) => {
      const before = stateRef.current;
      commit(applyOps(before, ops));
      pending.current++;
      try {
        await save(ops);
        showToast({
          message: label,
          undo: undoOps
            ? () => {
                void apply(undoOps, null, "Deshecho");
              }
            : null,
        });
        return true;
      } catch (err) {
        // Put back what this action changed (later actions stay).
        if (undoOps) commit(applyOps(stateRef.current, undoOps));
        showToast({
          message: err instanceof Error ? err.message : "No pude guardar.",
          undo: null,
          error: true,
        });
        return false;
      } finally {
        pending.current--;
      }
    },
    [commit, showToast]
  );

  /** Run a pure action on the current state. Returns false if it was refused or the save failed. */
  const run = useCallback(
    async (compute: (s: GroupsState) => OpResult): Promise<boolean> => {
      let result: OpResult;
      try {
        result = compute(stateRef.current);
      } catch (err) {
        showToast({
          message:
            err instanceof GroupOpError
              ? err.message
              : "No se pudo hacer ese cambio.",
          undo: null,
          error: true,
        });
        return false;
      }
      if (
        result.ops.upsert_groups.length +
          result.ops.upsert_members.length +
          result.ops.delete_group_ids.length +
          result.ops.delete_member_ids.length ===
        0
      ) {
        return true;
      }
      return apply(result.ops, result.undo, result.label);
    },
    [apply, showToast]
  );

  return useMemo(
    () => ({
      available,
      state,
      run,
      toast,
      dismissToast: () => showToast(null),
      notify: (message: string, error = false) =>
        showToast({ message, undo: null, error }),
    }),
    [available, state, run, toast, showToast]
  );
}

/** Expand/collapse state remembered per browser (and so per user). */
export function useRememberedSet(storageKey: string) {
  const [set, setSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    let stored: string[] | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) stored = JSON.parse(raw) as string[];
    } catch {
      // No storage: it just starts closed.
    }
    // After the first paint, so the server and the first client render agree.
    if (stored) queueMicrotask(() => setSet(new Set(stored)));
  }, [storageKey]);
  const toggle = useCallback(
    (id: string) =>
      setSet((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // ignore
        }
        return next;
      }),
    [storageKey]
  );
  return { set, toggle };
}
