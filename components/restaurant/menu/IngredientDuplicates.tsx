"use client";

// R1-15k (mock 10): «✦ Posibles duplicados · N grupos». A queue of every
// pending suggestion with n de N and ‹ ›, three actions (Unir, No son iguales,
// Ahora no) and a merge history with «Deshacer». Heuristics decide what is
// suggested (names, same unit family); a person decides what is merged. A
// merge is one transaction in the database and is always undoable.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildQueue,
  chooseSurvivor,
  findDuplicateSets,
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

export interface DupToast {
  message: string;
  undoMergeId?: string;
  error?: boolean;
}

async function post(path: string, body: unknown) {
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
  if (!res.ok) throw new Error(json.error ?? "No pude guardar el cambio.");
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
  /** A merge or an undo changed recipes and prices: re-read the page's data. */
  const onChanged = () => router.refresh();
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
      await post("/api/restaurant/ingredients/duplicates/decide", {
        ids: current.ids,
        action,
        source: current.source,
        score: current.score,
      });
      const now = new Date().toISOString();
      if (action === "reject") {
        setNotDup((prev) => {
          const next = new Set(prev);
          for (const a of current.ids)
            for (const b of current.ids) if (a < b) next.add(pairKey(a, b));
          return next;
        });
        show({ message: "Listo: ese grupo no se vuelve a sugerir." });
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
        show({ message: "Queda para después, al final de la lista." });
      }
      setActiveKey(null);
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : "No pude guardar.",
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
      const json = await post("/api/restaurant/ingredients/duplicates/merge", {
        survivor_id: plan.survivorId,
        loser_ids: plan.loserIds,
        chosen_cost_entry_id: plan.priceConflict ? chosenEntry : null,
        suggestion_id:
          current.storedId && !current.storedId.startsWith("local-")
            ? current.storedId
            : null,
      });
      const name = byId.get(plan.survivorId)?.name ?? "";
      show({
        message: `Unido en ${name}. Las recetas se actualizan al instante.`,
        undoMergeId: json.result?.merge_id,
      });
      setActiveKey(null);
      onChanged();
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : "No pude unir.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function undo(mergeId: string) {
    setBusy(true);
    try {
      await post("/api/restaurant/ingredients/duplicates/undo", {
        merge_id: mergeId,
      });
      setMerges((prev) =>
        prev.map((m) => (m.id === mergeId ? { ...m, undone: true } : m))
      );
      show({
        message: "Unión deshecha: recetas, precios y nombres como estaban.",
      });
      onChanged();
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : "No pude deshacer.",
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
        { items: rest }
      );
      if (json.unavailable) {
        show({
          message:
            "La IA no está configurada en este ambiente: solo hay sugerencias por nombre.",
        });
      } else if (!json.sets || json.sets.length === 0) {
        show({ message: "Milton no encontró más duplicados claros." });
      } else {
        show({ message: `Milton encontró ${json.sets.length} grupo(s) más.` });
        onChanged();
      }
    } catch (err) {
      show({
        message:
          err instanceof Error ? err.message : "Milton no pudo sugerir ahora.",
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
    undo,
    askAi,
    canAskAi: dupItems.filter((i) => !i.archived).length >= 4,
  };
}

export type DuplicateQueue = ReturnType<typeof useDuplicateQueue>;

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso + "T12:00:00").toLocaleDateString("es", {
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
          ✦ Posibles duplicados
          {q.queue.length > 0
            ? ` · ${q.queue.length} ${q.queue.length === 1 ? "grupo" : "grupos"}`
            : ""}
        </h2>
        {q.canAskAi && canEdit ? (
          <button
            type="button"
            onClick={() => void q.askAi()}
            disabled={q.busy}
            className="rounded-lg border border-[#1b40c8] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#1b40c8] hover:bg-[#e6ecfb] disabled:opacity-60"
          >
            {q.busy ? "Pensando…" : "✦ Pedir más a Milton"}
          </button>
        ) : null}
        {undoable.length > 0 ? (
          <button
            type="button"
            onClick={() => setHistory((v) => !v)}
            className="text-[12px] font-semibold text-[#4a5a85] underline"
          >
            Historial de uniones ({undoable.length})
          </button>
        ) : null}
        {q.queue.length > 0 ? (
          <span className="ml-auto flex items-center gap-1 text-[12px] text-[#6b7a9e]">
            <button
              type="button"
              aria-label="Anterior"
              onClick={() => q.move(-1)}
              className="rounded px-1.5 hover:bg-[#e6ecfb]"
            >
              ‹
            </button>
            {q.index + 1} de {q.queue.length}
            <button
              type="button"
              aria-label="Siguiente"
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
                        Se conserva
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-[12px] text-[#6b7a9e]">
                    {c.price !== null
                      ? `${money(c.price, c.priceUnit)} · ${fmtDate(c.priceDate)}`
                      : "Sin precio · —"}
                  </span>
                  <span className="block text-[12px] text-[#6b7a9e]">
                    {c.recipeCount} {c.recipeCount === 1 ? "receta" : "recetas"}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="min-w-0 break-words">
              Unir en <b>{byId.get(q.survivorId)?.name}</b> ·{" "}
              {q.plan.linesReassigned}{" "}
              {q.plan.linesReassigned === 1
                ? "línea de receta se reasigna"
                : "líneas de receta se reasignan"}{" "}
              · los nombres quedan como alias
            </span>
            {q.plan.priceConflict ? (
              <label className="inline-flex items-center gap-1 rounded-md bg-[#fff1d6] px-2 py-0.5 text-[12px] font-semibold text-[#a35a00]">
                Precio:
                <select
                  value={q.chosenEntry ?? ""}
                  onChange={(e) => q.setEntry(e.target.value)}
                  aria-label="Precio que se conserva"
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
                Ahora no
              </button>
              <button
                type="button"
                disabled={off}
                onClick={() => void q.decide("reject")}
                className="rounded-lg border border-[#c6d3f5] bg-white px-3 py-1.5 font-semibold text-[#4a5a85] disabled:opacity-50"
              >
                No son iguales
              </button>
              <button
                type="button"
                disabled={off}
                onClick={() => void q.merge()}
                className="rounded-lg bg-[#2f5be0] px-4 py-1.5 font-semibold text-white hover:bg-[#1b40c8] disabled:opacity-50"
              >
                Unir
              </button>
            </span>
          </div>
          {!q.available ? (
            <p className="text-[12px] text-[#a35a00]">
              Para unir falta aplicar las migraciones 050 y 051 en este
              ambiente.
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
                {new Date(m.createdAt).toLocaleDateString("es", {
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
                Deshacer
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
              Deshacer
            </button>
          ) : null}
          <button type="button" onClick={q.dismissToast} aria-label="Cerrar">
            ×
          </button>
        </div>
      ) : null}
    </section>
  );
}
