"use client";

// «Estimar con Milton» (issue #212): the one run flow, used by the menu
// reader (Costos) and by Menú › Platos. It asks the server for estimates in
// chunks (≤5 dishes per call, the best sellers first, 20 at most per run) and
// never stops for one dish that fails. Estimates are approximations kept
// apart from the real figures.

import { useEffect, useRef, useState } from "react";
import { GhostBtn } from "@/components/restaurant/recipes-costing/ui";
import {
  ESTIMATE_BUTTON,
  ESTIMATE_HELP,
  ESTIMATE_MISSING_TABLE,
} from "./estimate-overlay";

const ENDPOINT = "/api/restaurant/recipes/menu/estimate";
export const MAX_DISHES_PER_RUN = 20;

interface ChunkResult {
  menu_item_id: string;
  skipped_reason?: string | null;
}
interface ChunkResponse {
  done?: boolean;
  remaining?: number;
  results?: ChunkResult[];
  error?: string;
}

export interface EstimateRunState {
  running: boolean;
  /** Dishes handled so far (estimated or skipped). */
  processed: number;
  total: number;
  note: string | null;
  summary: string | null;
}

export function estimateSummary(estimated: number, skipped: number): string {
  const base = `Listo: ${estimated} ${estimated === 1 ? "plato estimado" : "platos estimados"}.`;
  if (skipped <= 0) return base;
  return `${base} ${skipped} ${skipped === 1 ? "plato quedó" : "platos quedaron"} sin estimar.`;
}

export function progressText(processed: number, total: number): string {
  return `Estimando ${Math.min(processed + 1, total)} de ${total} platos (los que más venden primero)…`;
}

/** The run loop. `onDone` runs after a run that estimated something. */
export function useEstimateRun({
  locationId,
  onDone,
}: {
  locationId: string | null;
  onDone: () => void;
}) {
  const [state, setState] = useState<EstimateRunState>({
    running: false,
    processed: 0,
    total: 0,
    note: null,
    summary: null,
  });
  const runningRef = useRef(false);

  async function start(eligible: number | null) {
    if (runningRef.current) return;
    runningRef.current = true;
    const total = Math.max(
      1,
      Math.min(MAX_DISHES_PER_RUN, eligible && eligible > 0 ? eligible : 20)
    );
    setState({ running: true, processed: 0, total, note: null, summary: null });
    const seen = new Set<string>();
    let estimated = 0;
    let skipped = 0;
    let failedInARow = 0;
    let note: string | null = null;
    try {
      while (seen.size < total) {
        let json: ChunkResponse = {};
        let status = 0;
        try {
          const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              location_id: locationId ?? undefined,
              limit: total - seen.size,
            }),
          });
          status = res.status;
          json = (await res.json().catch(() => ({}))) as ChunkResponse;
          if (!res.ok) throw new Error(json.error ?? "No pude estimar.");
        } catch {
          if (status === 503) {
            note = ESTIMATE_MISSING_TABLE;
            break;
          }
          failedInARow += 1;
          if (failedInARow >= 2) break;
          continue;
        }
        failedInARow = 0;
        const results = json.results ?? [];
        let fresh = 0;
        for (const r of results) {
          if (seen.has(r.menu_item_id)) continue;
          seen.add(r.menu_item_id);
          fresh += 1;
          if (r.skipped_reason) skipped += 1;
          else estimated += 1;
        }
        setState((prev) => ({ ...prev, processed: seen.size }));
        // Nothing new (all repeated or empty): stop, never loop forever.
        if (fresh === 0 || json.done) break;
      }
    } finally {
      runningRef.current = false;
      setState({
        running: false,
        processed: seen.size,
        total,
        note,
        summary: note ? null : estimateSummary(estimated, skipped),
      });
    }
    if (estimated > 0) onDone();
  }

  return { state, start };
}

/**
 * The button (or a small link) with its progress and summary. Hidden without
 * permission and when there is nothing to estimate (unless `forceShow`, right
 * after a menu reading that prepared drafts).
 */
export function EstimateWithMilton({
  canEdit,
  locationId,
  onDone,
  forceShow = false,
  busyExternal = false,
  variant = "button",
}: {
  canEdit: boolean;
  locationId: string | null;
  onDone: () => void;
  forceShow?: boolean;
  busyExternal?: boolean;
  variant?: "button" | "link";
}) {
  const [probe, setProbe] = useState<{
    available: boolean;
    eligible: number;
  } | null>(null);
  const { state, start } = useEstimateRun({ locationId, onDone });

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    const q = locationId
      ? `?location_id=${encodeURIComponent(locationId)}`
      : "";
    void (async () => {
      try {
        const res = await fetch(`${ENDPOINT}${q}`);
        if (!res || !res.ok) return;
        const json = (await res.json()) as {
          available?: boolean;
          eligible?: number;
        };
        if (!cancelled)
          setProbe({
            available: json.available === true,
            eligible: Number(json.eligible ?? 0),
          });
      } catch {
        // No probe: the button stays hidden, as before this feature.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, locationId]);

  if (!canEdit) return null;
  const hasWork = probe ? probe.available && probe.eligible > 0 : false;
  const shown = hasWork || forceShow || state.running || state.summary;
  if (!shown && !state.note) return null;

  const label = state.running ? "Estimando…" : ESTIMATE_BUTTON;
  return (
    <div className="space-y-1.5" data-testid="estimate-with-milton">
      {variant === "link" ? (
        <button
          type="button"
          disabled={state.running || busyExternal}
          title={ESTIMATE_HELP}
          onClick={() => void start(probe?.eligible ?? null)}
          className="font-semibold text-[#3557c9] disabled:opacity-60"
        >
          {label}
        </button>
      ) : (
        <>
          <GhostBtn
            disabled={state.running || busyExternal}
            onClick={() => void start(probe?.eligible ?? null)}
          >
            {label}
          </GhostBtn>
          <p className="text-[12px] text-[#6b7280]">{ESTIMATE_HELP}</p>
        </>
      )}
      {state.running ? (
        <p role="status" className="text-[12px] text-[#6b7280]">
          {progressText(state.processed, state.total)}
        </p>
      ) : null}
      {state.note ? (
        <p className="text-[12px] text-[#6b7280]">{state.note}</p>
      ) : null}
      {state.summary ? (
        <p className="text-[12px] text-[#6b7280]">{state.summary}</p>
      ) : null}
    </div>
  );
}
