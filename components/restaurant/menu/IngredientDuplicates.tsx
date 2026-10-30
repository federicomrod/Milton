"use client";

// R1-15k (mock 10): «✦ Posibles duplicados · N grupos». A queue of every
// pending suggestion with n de N and ‹ ›, three actions (Unir, No son iguales,
// Ahora no) and a merge history with «Deshacer». Heuristics decide what is
// suggested (names, same unit family); a person decides what is merged. A
// merge is one transaction in the database and is always undoable.

import { useT } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildQueue,
  chooseSurvivor,
  findDuplicateSets,
  mergeUnitMismatch,
  pairKey,
  planMerge,
  type MergeCandidate,
  type QueueEntry,
  type StoredSuggestion,
} from "@/lib/restaurant/ingredient-duplicates";
import type {
  DuplicateState,
  MergeRecord,
} from "@/lib/restaurant/ingredient-duplicates-server";
import type { IngredienteItem } from "./IngredientesScreen";
import { clearIngredientOptionsCache } from "@/components/restaurant/recipes-costing/ingredient-options";
import { userErrorMessage } from "@/lib/restaurant/user-error";

export interface DupToast {
  message: string;
  undoMergeId?: string;
  error?: boolean;
}

async function post(path: string, body: unknown, fallback: string) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    result?: { merge_id?: string };
    sets?: unknown[];
    unavailable?: boolean;
  };
  if (!res.ok) throw new Error(userErrorMessage(json, fallback));
  return json;
}

export function useDuplicateQueue({
  items,
  duplicates,
}: {
  items: readonly IngredienteItem[];
  duplicates: DuplicateState;
}) {
  const router = useRouter();
  const { d } = useT();
  const t = d.menu.screens.dup;
  /** A merge or an undo changed recipes and prices: re-read the page's data. */
  const onChanged = () => {
    // The Reventa picker keeps the ingredient list for a minute: drop it.
    clearIngredientOptionsCache();
    router.refresh();
  };
  const [stored, setStored] = useState<StoredSuggestion[]>(duplicates.stored);
  const [notDup, setNotDup] = useState<Set<string>>(
    () => new Set(duplicates.notDuplicates)
  );
  const [merges, setMerges] = useState<MergeRecord[]>(duplicates.merges);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [survivorOf, setSurvivorOf] = useState<Record<string, string>>({});
  const [entryOf, setEntryOf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<DupToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh server copy replaces ours (after a refresh).
  const [seen, setSeen] = useState(duplicates);
  if (seen !== duplicates) {
    setSeen(duplicates);
    setStored(duplicates.stored);
    setNotDup(new Set(duplicates.notDuplicates));
    setMerges(duplicates.merges);
  }

  const show = useCallback((next: DupToast | null) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    if (next && !next.error)
      timer.current = setTimeout(() => setToast(null), 8000);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  // Names and units only: a price edit must not redo the comparison.
  const signature = items
    .map(
      (i) =>
        `${i.id}|${i.name}|${i.default_unit ?? i.price_unit ?? ""}|${i.archived ? 1 : 0}`
    )
    .join("\n");
  const dupItems = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.default_unit ?? i.price_unit,
        archived: i.archived,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature]
  );
  const detected = useMemo(
    () => findDuplicateSets(dupItems, notDup),
    [dupItems, notDup]
  );
  const queue = useMemo(
    () =>
      buildQueue({ detected, stored, items: dupItems, notDuplicates: notDup }),
    [detected, stored, dupItems, notDup]
  );
  const flagged = useMemo(() => new Set(queue.flatMap((q) => q.ids)), [queue]);

  const index = Math.max(
    0,
    queue.findIndex((q) => q.key === activeKey)
  );
  const current: QueueEntry | null = queue[index] ?? null;

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const candidates: MergeCandidate[] = useMemo(
    () =>
      (current?.ids ?? [])
        .map((id) => byId.get(id))
        .filter((i): i is IngredienteItem => !!i)
        .map((i) => ({
          id: i.id,
          name: i.name,
          price: i.price,
          priceUnit: i.price_unit,
          priceDate: i.price_date,
          priceSourced: i.price !== null,
          priceEntryId: i.price_entry_id ?? null,
          recipeCount: i.recipeCount ?? 0,
          lineCount: i.lineCount ?? 0,
        })),
    [current, byId]
  );
  const survivorId =
    current &&
    survivorOf[current.key] &&
    current.ids.includes(survivorOf[current.key])
      ? survivorOf[current.key]
      : candidates.length > 0
        ? chooseSurvivor(candidates)
        : "";
  const plan =
    candidates.length > 1 && survivorId
      ? planMerge(candidates, survivorId)
      : null;
  const chosenEntry =
    current && plan
      ? entryOf[current.key] &&
        plan.priceOptions.some((o) => o.entryId === entryOf[current.key])
        ? entryOf[current.key]
        : plan.defaultEntryId
      : null;

  const move = (delta: number) => {
    if (queue.length === 0) return;
    setActiveKey(queue[(index + delta + queue.length) % queue.length].key);
  };

  /** A click on an ingredient that belongs to a suggestion jumps the banner to it; otherwise it stays. */
  const jumpTo = useCallback(
    (ingredientId: string) => {
      const hit = queue.find((q) => q.ids.includes(ingredientId));
      if (hit) setActiveKey(hit.key);
    },
    [queue]
  );

  async function decide(action: "skip" | "reject") {
    if (!current) return;
    setBusy(true);
    try {
      await post(
        "/api/restaurant/ingredients/duplicates/decide",
        {
          ids: current.ids,
          action,
          source: current.source,
          score: current.score,
        },
        t.errSaveChange
      );
      const now = new Date().toISOString();
      if (action === "reject") {
        setNotDup((prev) => {
          const next = new Set(prev);
          for (const a of current.ids)
            for (const b of current.ids) if (a < b) next.add(pairKey(a, b));
          return next;
        });
        show({ message: t.toastRejected });
      } else {
        // «Ahora no»: the end of the queue, still pending.
        setStored((prev) => [
          ...prev.filter((s) => s.key !== current.key),
          {
            id: current.storedId ?? `local-${current.key}`,
            ids: current.ids,
            key: current.key,
            source: current.source,
            score: current.score,
            status: "skipped",
            skippedAt: now,
          },
        ]);
        show({ message: t.toastLater });
      }
      setActiveKey(null);
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : t.errSave,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!current || !plan) return;
    setBusy(true);
    try {
      const json = await post(
        "/api/restaurant/ingredients/duplicates/merge",
        {
          survivor_id: plan.survivorId,
          loser_ids: plan.loserIds,
          chosen_cost_entry_id: plan.priceConflict ? chosenEntry : null,
          suggestion_id:
            current.storedId && !current.storedId.startsWith("local-")
              ? current.storedId
              : null,
        },
        t.errSaveChange
      );
      const name = byId.get(plan.survivorId)?.name ?? "";
      show({
        message: fmt(t.toastMerged, { name }),
        undoMergeId: json.result?.merge_id,
      });
      setActiveKey(null);
      onChanged();
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : t.errMerge,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  /** «Unir…» from the selection bar: same route, same transaction. Returns an error message, or null when it worked. */
  async function mergeManual(
    survivorId: string,
    loserIds: string[],
    chosenEntryId: string | null,
    survivorName: string
  ): Promise<string | null> {
    setBusy(true);
    try {
      const json = await post(
        "/api/restaurant/ingredients/duplicates/merge",
        {
          survivor_id: survivorId,
          loser_ids: loserIds,
          chosen_cost_entry_id: chosenEntryId,
          suggestion_id: null,
        },
        t.errSaveChange
      );
      show({
        message: fmt(t.toastMerged, { name: survivorName }),
        undoMergeId: json.result?.merge_id,
      });
      onChanged();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : t.errMerge;
    } finally {
      setBusy(false);
    }
  }

  async function undo(mergeId: string) {
    setBusy(true);
    try {
      await post(
        "/api/restaurant/ingredients/duplicates/undo",
        { merge_id: mergeId },
        t.errSaveChange
      );
      setMerges((prev) =>
        prev.map((m) => (m.id === mergeId ? { ...m, undone: true } : m))
      );
      show({
        message: t.toastUndone,
      });
      onChanged();
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : t.errUndo,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  /** Milton looks for more with what the names left over (names and units only). */
  async function askAi() {
    setBusy(true);
    try {
      const covered = new Set(queue.flatMap((q) => q.ids));
      const rest = dupItems.filter((i) => !i.archived && !covered.has(i.id));
      const json = await post(
        "/api/restaurant/ingredients/duplicates/suggest",
        { items: rest },
        t.errSaveChange
      );
      if (json.unavailable) {
        show({ message: t.toastOnlyNames });
      } else if (!json.sets || json.sets.length === 0) {
        show({ message: t.toastNoMore });
      } else {
        show({ message: fmt(t.toastFoundMore, { n: json.sets.length }) });
        onChanged();
      }
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : t.errAsk,
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return {
    available: duplicates.available,
    queue,
    index,
    current,
    candidates,
    plan,
    survivorId,
    chosenEntry,
    flagged,
    merges,
    toast,
    busy,
    dismissToast: () => show(null),
    move,
    jumpTo,
    setSurvivor: (id: string) =>
      current && setSurvivorOf((p) => ({ ...p, [current.key]: id })),
    setEntry: (id: string) =>
      current && setEntryOf((p) => ({ ...p, [current.key]: id })),
    decide,
    merge,
    mergeManual,
    undo,
    askAi,
    canAskAi: dupItems.filter((i) => !i.archived).length >= 4,
  };
}

export type DuplicateQueue = ReturnType<typeof useDuplicateQueue>;

const fmtDate = (iso: string | null, locale: string) =>
  iso
    ? new Date(iso + "T12:00:00").toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
      })
    : "—";

export function DuplicatesBanner({
  q,
  money,
  canEdit,
}: {
  q: DuplicateQueue;
  money: (n: number, unit: string | null) => string;
  canEdit: boolean;
}) {
  const { d, locale } = useT();
  const t = d.menu.screens.dup;
  const [history, setHistory] = useState(false);
  const undoable = q.merges.filter((m) => !m.undone);
  if (q.queue.length === 0 && undoable.length === 0 && !q.toast && !q.canAskAi)
    return null;
  const off = !canEdit || !q.available || q.busy;
  const byId = new Map(q.candidates.map((c) => [c.id, c]));
  return (
    <section
      className="space-y-2 rounded-[14px] border border-[#dbe3f7] bg-[#f6f8fe] px-4 py-2.5"
      data-testid="duplicates-banner"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-bold text-[#1b40c8]">
          {t.title}
          {q.queue.length > 0
            ? ` · ${fmt(q.queue.length === 1 ? t.groupsOne : t.groupsOther, { n: q.queue.length })}`
            : ""}
        </h2>
        {q.canAskAi && canEdit ? (
          <button
            type="button"
            onClick={() => void q.askAi()}
            disabled={q.busy}
            className="rounded-lg border border-[#1b40c8] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#1b40c8] hover:bg-[#e6ecfb] disabled:opacity-60"
          >
            {q.busy ? t.thinking : t.askMore}
          </button>
        ) : null}
        {undoable.length > 0 ? (
          <button
            type="button"
            onClick={() => setHistory((v) => !v)}
            className="text-[12px] font-semibold text-[#4a5a85] underline"
          >
            {fmt(t.history, { n: undoable.length })}
          </button>
        ) : null}
        {q.queue.length > 0 ? (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-[#6b7a9e]">
            <button
              type="button"
              aria-label={t.prev}
              onClick={() => q.move(-1)}
              className="rounded px-1.5 hover:bg-[#e6ecfb]"
            >
              ‹
            </button>
            {fmt(t.position, { current: q.index + 1, total: q.queue.length })}
            <button
              type="button"
              aria-label={t.next}
              onClick={() => q.move(1)}
              className="rounded px-1.5 hover:bg-[#e6ecfb]"
            >
              ›
            </button>
          </span>
        ) : null}
      </div>

      {q.current && q.plan ? (
        <>
          <div className="flex flex-wrap gap-2">
            {q.current.ids.map((id) => {
              const c = byId.get(id);
              if (!c) return null;
              const keep = id === q.survivorId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => q.setSurvivor(id)}
                  aria-pressed={keep}
                  title={c.name}
                  className={
                    "min-w-0 max-w-[280px] flex-1 basis-[180px] rounded-xl border-2 bg-white px-3 py-1.5 text-left " +
                    (keep
                      ? "border-[#1b40c8]"
                      : "border-[#e1e8fa] hover:border-[#a9bcf0]")
                  }
                >
                  <span className="line-clamp-2 break-words text-[13px] font-bold text-[#151c2c]">
                    {c.name}
                    {keep ? (
                      <span className="ml-2 rounded bg-[#dcf3e4] px-1.5 py-0.5 text-[12px] font-semibold text-[#15803d]">
                        {t.kept}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-[12px] text-[#6b7a9e]">
                    {c.price !== null
                      ? `${money(c.price, c.priceUnit)} · ${fmtDate(c.priceDate, locale)}`
                      : `${d.menu.screens.noPrice} · —`}
                  </span>
                  <span className="block text-[12px] text-[#6b7a9e]">
                    {fmt(c.recipeCount === 1 ? t.recipesOne : t.recipesOther, {
                      n: c.recipeCount,
                    })}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="min-w-0 break-words">
              {t.mergeInto} <b>{byId.get(q.survivorId)?.name}</b> ·{" "}
              {q.plan.linesReassigned}{" "}
              {q.plan.linesReassigned === 1 ? t.linesOne : t.linesOther} ·{" "}
              {t.aliasTail}
            </span>
            {q.plan.priceConflict ? (
              <label className="inline-flex items-center gap-1 rounded-md bg-[#f9fafb] px-2 py-0.5 text-[12px] font-semibold text-[#6b7280]">
                {t.priceLabel}
                <select
                  value={q.chosenEntry ?? ""}
                  onChange={(e) => q.setEntry(e.target.value)}
                  aria-label={t.keptPrice}
                  className="bg-transparent font-semibold outline-none"
                >
                  {q.plan.priceOptions.map((o) => (
                    <option key={o.entryId} value={o.entryId}>
                      {money(o.price, o.unit)} ({o.from})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                disabled={off}
                onClick={() => void q.decide("skip")}
                className="rounded-lg border border-[#c6d3f5] bg-white px-3 py-1.5 font-semibold text-[#4a5a85] disabled:opacity-50"
              >
                {t.later}
              </button>
              <button
                type="button"
                disabled={off}
                onClick={() => void q.decide("reject")}
                className="rounded-lg border border-[#c6d3f5] bg-white px-3 py-1.5 font-semibold text-[#4a5a85] disabled:opacity-50"
              >
                {t.notSame}
              </button>
              <button
                type="button"
                disabled={off}
                onClick={() => void q.merge()}
                className="rounded-lg bg-[#2f5be0] px-4 py-1.5 font-semibold text-white hover:bg-[#1b40c8] disabled:opacity-50"
              >
                {t.merge}
              </button>
            </span>
          </div>
          {!q.available ? (
            <p className="text-[12px] text-[#6b7280]">
              {d.menu.screens.notAvailableYet}
            </p>
          ) : null}
        </>
      ) : null}

      {history && undoable.length > 0 ? (
        <ul className="divide-y divide-[#e1e8fa] rounded-lg bg-white text-[13px]">
          {undoable.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1">
                <b>{m.survivorName}</b> ← {m.loserNames.join(", ")}
              </span>
              <span className="text-[12px] text-[#6b7a9e]">
                {new Date(m.createdAt).toLocaleDateString(locale, {
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <button
                type="button"
                disabled={off}
                onClick={() => void q.undo(m.id)}
                className="font-semibold text-[#1b40c8] disabled:opacity-50"
              >
                {t.undo}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {q.toast ? (
        <div
          role={q.toast.error ? "alert" : "status"}
          className={
            "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] " +
            (q.toast.error
              ? "bg-[#fdecec] text-[#c03535]"
              : "bg-[#151c2c] text-white")
          }
        >
          <span className="flex-1">{q.toast.message}</span>
          {q.toast.undoMergeId ? (
            <button
              type="button"
              onClick={() => void q.undo(q.toast!.undoMergeId!)}
              className="font-semibold underline"
            >
              {t.undo}
            </button>
          ) : null}
          <button type="button" onClick={q.dismissToast} aria-label={t.close}>
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}

function candidateOf(i: IngredienteItem): MergeCandidate {
  return {
    id: i.id,
    name: i.name,
    price: i.price,
    priceUnit: i.price_unit,
    priceDate: i.price_date,
    priceSourced: i.price !== null,
    priceEntryId: i.price_entry_id ?? null,
    recipeCount: i.recipeCount ?? 0,
    lineCount: i.lineCount ?? 0,
  };
}

/**
 * «Unir…» from the selection bar (2+ ingredients): «¿Cuál se conserva?». The
 * pre-pick is the banner's (has a price, newest price, more recipes, A–Z); when
 * the prices differ the person picks one, never an average. Confirming calls
 * the same merge route as the banner.
 */
export function ManualMergeDialog({
  q,
  items,
  ids,
  money,
  onClose,
  onMerged,
}: {
  q: DuplicateQueue;
  items: readonly IngredienteItem[];
  ids: readonly string[];
  money: (n: number, unit: string | null) => string;
  onClose: () => void;
  onMerged: (survivorId: string, loserIds: string[]) => void;
}) {
  const { d, lang, locale } = useT();
  const t = d.menu.screens.dup;
  const candidates = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return ids
      .map((id) => byId.get(id))
      .filter((i): i is IngredienteItem => !!i && !i.archived)
      .map(candidateOf);
  }, [items, ids]);
  const [survivorPick, setSurvivorPick] = useState<string | null>(null);
  const [entryPick, setEntryPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (candidates.length < 2) return null;
  const survivorId =
    survivorPick && candidates.some((c) => c.id === survivorPick)
      ? survivorPick
      : chooseSurvivor(candidates);
  const plan = planMerge(candidates, survivorId);
  const chosenEntry = plan.priceConflict
    ? entryPick && plan.priceOptions.some((o) => o.entryId === entryPick)
      ? entryPick
      : plan.defaultEntryId
    : null;
  const unitById = new Map(
    items.map((i) => [i.id, i.default_unit ?? i.price_unit])
  );
  const mismatch = mergeUnitMismatch(
    candidates.map((c) => ({ name: c.name, unit: unitById.get(c.id) ?? null })),
    lang
  );
  const survivor = candidates.find((c) => c.id === survivorId)!;
  const blocked = q.busy || !!mismatch || !q.available;

  async function confirm() {
    setError(null);
    const failure = await q.mergeManual(
      plan.survivorId,
      plan.loserIds,
      chosenEntry,
      survivor.name
    );
    if (failure) setError(failure);
    else onMerged(plan.survivorId, plan.loserIds);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t.dialogLabel}
      data-testid="manual-merge-dialog"
    >
      <div className="max-h-full w-full max-w-[640px] space-y-3 overflow-y-auto rounded-[14px] border border-[#dbe3f7] bg-white p-4 shadow-xl">
        <h2 className="text-[15px] font-bold text-[#151c2c]">{t.whichKept}</h2>
        <div className="flex flex-wrap gap-2">
          {candidates.map((c) => {
            const keep = c.id === survivorId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSurvivorPick(c.id)}
                aria-pressed={keep}
                title={c.name}
                className={
                  "min-w-0 max-w-[280px] flex-1 basis-[180px] rounded-xl border-2 bg-white px-3 py-1.5 text-left " +
                  (keep
                    ? "border-[#1b40c8]"
                    : "border-[#e1e8fa] hover:border-[#a9bcf0]")
                }
              >
                <span className="line-clamp-2 break-words text-[13px] font-bold text-[#151c2c]">
                  {c.name}
                  {keep ? (
                    <span className="ml-2 rounded bg-[#dcf3e4] px-1.5 py-0.5 text-[12px] font-semibold text-[#15803d]">
                      {t.kept}
                    </span>
                  ) : null}
                </span>
                <span className="block text-[12px] text-[#6b7a9e]">
                  {c.price !== null
                    ? `${money(c.price, c.priceUnit)} · ${fmtDate(c.priceDate, locale)}`
                    : `${d.menu.screens.noPrice} · —`}
                </span>
                <span className="block text-[12px] text-[#6b7a9e]">
                  {fmt(c.recipeCount === 1 ? t.recipesOne : t.recipesOther, {
                    n: c.recipeCount,
                  })}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[13px]">
          {t.mergeInto} <b>{survivor.name}</b> · {plan.linesReassigned}{" "}
          {plan.linesReassigned === 1 ? t.linesOne : t.linesOther} ·{" "}
          {t.aliasTailArchive}
        </p>
        {plan.priceConflict ? (
          <label className="inline-flex items-center gap-1 rounded-md bg-[#f9fafb] px-2 py-0.5 text-[12px] font-semibold text-[#6b7280]">
            {t.pricesDiffer}
            <select
              value={chosenEntry ?? ""}
              onChange={(e) => setEntryPick(e.target.value)}
              aria-label={t.keptPrice}
              className="bg-transparent font-semibold outline-none"
            >
              {plan.priceOptions.map((o) => (
                <option key={o.entryId} value={o.entryId}>
                  {money(o.price, o.unit)} ({o.from})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {mismatch || error ? (
          <p
            role="alert"
            className="rounded-lg bg-[#fdecec] px-3 py-2 text-[13px] text-[#c03535]"
          >
            {mismatch ?? error}
          </p>
        ) : null}
        {!q.available ? (
          <p className="text-[12px] text-[#6b7280]">
            {d.menu.screens.notAvailableYet}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 text-[13px]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#c6d3f5] bg-white px-3 py-1.5 font-semibold text-[#4a5a85]"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => void confirm()}
            className="rounded-lg bg-[#2f5be0] px-4 py-1.5 font-semibold text-white hover:bg-[#1b40c8] disabled:opacity-50"
          >
            {q.busy ? t.merging : t.merge}
          </button>
        </div>
      </div>
    </div>
  );
}
