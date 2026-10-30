"use client";

// R1-15c: the groups on screen. Every action is applied at once (pure
// group-ops), saved in one transaction in the background, rolled back with a
// message if the save fails, and offered as "Deshacer" for a few seconds.
// Nothing here recalculates a number: sums come from costing/rollup.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GroupOpError,
  applyOps,
  opText,
  replayOps,
  type GroupOps,
  type GroupsState,
  type OpResult,
} from "@/lib/restaurant/groups/group-ops";
import type { ItemGroupsLoad } from "@/lib/restaurant/groups/item-groups";
import { userErrorMessage } from "@/lib/restaurant/user-error";
import { useT } from "@/lib/i18n/client";

export interface GroupToast {
  message: string;
  /** Present while "Deshacer" is on offer. */
  undo: (() => void) | null;
  error?: boolean;
}

const UNDO_MS = 8000;

async function save(ops: GroupOps, failedText: string): Promise<void> {
  const res = await fetch("/api/restaurant/item-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops }),
  });
  if (res.ok) return;
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(userErrorMessage(json, failedText));
}

// The changes made in this browser session, newest last. A payload that was
// read before a save (cached tab, slow read) is replayed over, never trusted
// over, a change the person just made. Entries older than five minutes are
// dropped: by then every payload has been re-read.
const sessionLog: Array<{ id: number; at: number; ops: GroupOps }> = [];
let logSeq = 0;
const LOG_TTL_MS = 5 * 60_000;

function reconcile(initial: ItemGroupsLoad | null | undefined): GroupsState {
  const cutoff = Date.now() - LOG_TTL_MS;
  while (sessionLog.length > 0 && sessionLog[0].at < cutoff) sessionLog.shift();
  return replayOps(
    { groups: initial?.groups ?? [], members: initial?.members ?? [] },
    sessionLog.map((e) => e.ops)
  );
}

export function useItemGroups(initial: ItemGroupsLoad | null | undefined) {
  const { d, lang } = useT();
  const hook = d.menu.groups.hook;
  const available = initial?.available === true;
  const [state, setState] = useState<GroupsState>(() => reconcile(initial));
  const stateRef = useRef(state);
  const pending = useRef(0);
  const [toast, setToast] = useState<GroupToast | null>(null);
  /** The group a person just created: to scroll to and flash for a moment. */
  const [created, setCreated] = useState<{ id: string; n: number } | null>(
    null
  );
  const createdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: GroupsState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // A new server copy replaces ours, with this session's changes on top.
  useEffect(() => {
    if (!initial) return;
    commit(reconcile(initial));
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
      if (createdTimer.current) clearTimeout(createdTimer.current);
    },
    []
  );

  const apply = useCallback(
    async (ops: GroupOps, undoOps: GroupOps | null, label: string) => {
      const before = stateRef.current;
      const known = new Set(before.groups.map((g) => g.id));
      // A group that just became real: new, or a suggestion that was accepted.
      const fresh = ops.upsert_groups.find(
        (g) =>
          g.source !== "auto" &&
          g.status === "confirmed" &&
          (!known.has(g.id) ||
            before.groups.find((x) => x.id === g.id)?.status === "suggested")
      );
      const entry = { id: ++logSeq, at: Date.now(), ops };
      sessionLog.push(entry);
      commit(applyOps(before, ops));
      if (fresh) {
        if (createdTimer.current) clearTimeout(createdTimer.current);
        setCreated((c) => ({ id: fresh.id, n: (c?.n ?? 0) + 1 }));
        createdTimer.current = setTimeout(() => setCreated(null), 2600);
      }
      pending.current++;
      try {
        await save(ops, hook.saveGroupingFailed);
        showToast({
          message: label,
          undo: undoOps
            ? () => {
                void apply(undoOps, null, hook.undone);
              }
            : null,
        });
        return true;
      } catch (err) {
        // Put back what this action changed (later actions stay).
        const at = sessionLog.findIndex((e) => e.id === entry.id);
        if (at >= 0) sessionLog.splice(at, 1);
        if (undoOps) commit(applyOps(stateRef.current, undoOps));
        showToast({
          message: err instanceof Error ? err.message : hook.saveFailed,
          undo: null,
          error: true,
        });
        return false;
      } finally {
        pending.current--;
      }
    },
    [commit, showToast, hook]
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
              ? err.key
                ? opText(lang, err.key, err.vars)
                : err.message
              : hook.changeFailed,
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
      return apply(
        result.ops,
        result.undo,
        opText(lang, result.labelKey, result.labelVars)
      );
    },
    [apply, showToast, lang, hook]
  );

  return useMemo(
    () => ({
      available,
      state,
      run,
      created,
      toast,
      dismissToast: () => showToast(null),
      notify: (message: string, error = false) =>
        showToast({ message, undo: null, error }),
    }),
    [available, state, run, created, toast, showToast]
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
  /** Open these groups (and keep them open next time). */
  const add = useCallback(
    (ids: readonly string[]) =>
      setSet((prev) => {
        if (ids.every((id) => prev.has(id))) return prev;
        const next = new Set([...prev, ...ids]);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {
          // ignore
        }
        return next;
      }),
    [storageKey]
  );
  return { set, toggle, add };
}

/**
 * After "Crear grupo": open the new group's parents, let the screen show it
 * (clear the search / switch the filter) and scroll it into view. Returns the
 * id to highlight for a moment.
 */
export function useGroupFocus(
  grouping: { created: { id: string; n: number } | null; state: GroupsState },
  open: { add: (ids: readonly string[]) => void },
  reveal?: () => void
): string | null {
  const created = grouping.created;
  const groups = grouping.state.groups;
  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  });
  useEffect(() => {
    if (!created) return;
    const byId = new Map(groups.map((g) => [g.id, g]));
    const parents: string[] = [];
    let cursor = byId.get(created.id);
    for (let guard = 0; cursor?.parent_id && guard < 20; guard++) {
      parents.push(cursor.parent_id);
      cursor = byId.get(cursor.parent_id);
    }
    queueMicrotask(() => {
      open.add(parents);
      revealRef.current?.();
    });
    const t = setTimeout(() => {
      document
        .querySelector(`[data-group-id="${created.id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => clearTimeout(t);
    // Only a new creation (n) should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created?.n]);
  return created?.id ?? null;
}
