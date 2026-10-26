"use client";

// «Estimar con Milton» (issue #212): the one run flow, used by the menu
// reader (Costos) and by Menú › Platos. It asks the server for estimates in
// chunks (≤5 dishes per call, the best sellers first, 20 at most per run) and
// never stops for one dish that fails. Estimates are approximations kept
// apart from the real figures.

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { CAPABILITY_MESSAGES } from "@/lib/auth/capabilities";
import {
  GhostBtn,
  PrimaryBtn,
} from "@/components/restaurant/recipes-costing/ui";
import {
  ESTIMATE_BUTTON,
  ESTIMATE_HELP,
  ESTIMATE_MISSING_TABLE,
  ESTIMATE_NEEDS_LINK,
  ESTIMATE_NOTHING_TO_DO,
  ESTIMATE_NO_ROLE_HINT,
  ESTIMATE_PROBE_FAILED,
  ESTIMATE_RETRY,
  ESTIMATE_UNAVAILABLE,
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

/** Why the person cannot edit recipes: the shared message plus what to do. */
export function NoRecipeEditNotice({ className = "" }: { className?: string }) {
  return (
    <p
      className={"text-[12px] text-[var(--brand-muted)] " + className}
      data-testid="recipes-edit-denied"
    >
      {CAPABILITY_MESSAGES["recipes.edit"]} {ESTIMATE_NO_ROLE_HINT}
    </p>
  );
}

type Probe =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ok"; available: boolean; eligible: number; needs_link: number };

/**
 * The button (or a small link) with its progress and summary. It always
 * renders: without `recipes.edit`, with estimates not active, with nothing to
 * estimate or with a failed check it is disabled and says why, never hidden.
 * `onVisibleChange` tells a card when the run button is live (so it can keep
 * a single primary button).
 */
export function EstimateWithMilton({
  canEdit,
  locationId,
  onDone,
  forceShow = false,
  busyExternal = false,
  variant = "button",
  onVisibleChange,
  hideNoRoleNotice = false,
}: {
  /** From capabilities["recipes.edit"] (see canEditRecipes). */
  canEdit: boolean;
  locationId: string | null;
  onDone: () => void;
  forceShow?: boolean;
  busyExternal?: boolean;
  variant?: "button" | "link" | "primary";
  onVisibleChange?: (live: boolean) => void;
  hideNoRoleNotice?: boolean;
}) {
  const [probe, setProbe] = useState<Probe>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
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
        if (!res || !res.ok) throw new Error("probe");
        const json = (await res.json()) as {
          available?: boolean;
          eligible?: number;
          needs_link?: number;
        };
        if (!cancelled)
          setProbe({
            status: "ok",
            available: json.available === true,
            eligible: Number(json.eligible ?? 0),
            needs_link: Number(json.needs_link ?? 0),
          });
      } catch {
        if (!cancelled) setProbe({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, locationId, attempt]);

  const eligible = probe.status === "ok" ? probe.eligible : null;
  const hasWork =
    probe.status === "ok" && probe.available && probe.eligible > 0;
  const live =
    canEdit &&
    (hasWork || forceShow || state.running || Boolean(state.summary));
  useEffect(() => {
    onVisibleChange?.(Boolean(live));
  }, [live, onVisibleChange]);

  // Why the button is off (one line), in priority order.
  let reason: React.ReactNode = null;
  if (!canEdit) {
    reason = hideNoRoleNotice ? null : <NoRecipeEditNotice />;
  } else if (!live && !state.note) {
    if (probe.status === "failed") {
      reason = (
        <p className="text-[12px] text-[var(--brand-muted)]">
          {ESTIMATE_PROBE_FAILED}{" "}
          <button
            type="button"
            onClick={() => {
              setProbe({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className="font-semibold text-[var(--brand-blue)] hover:underline"
          >
            {ESTIMATE_RETRY}
          </button>
        </p>
      );
    } else if (probe.status === "ok" && !probe.available) {
      reason = (
        <p className="text-[12px] text-[var(--brand-muted)]">
          {ESTIMATE_UNAVAILABLE}
        </p>
      );
    } else if (probe.status === "ok") {
      reason = (
        <p className="text-[12px] text-[var(--brand-muted)]">
          {probe.needs_link > 0 ? ESTIMATE_NEEDS_LINK : ESTIMATE_NOTHING_TO_DO}
        </p>
      );
    }
  }

  const disabled = !live || state.running || busyExternal;
  const label = state.running ? "Estimando…" : ESTIMATE_BUTTON;
  const Btn = variant === "primary" ? PrimaryBtn : GhostBtn;
  return (
    <div className="space-y-1.5" data-testid="estimate-with-milton">
      {variant === "link" ? (
        <GhostBtn
          disabled={disabled}
          onClick={() => void start(eligible)}
          className="hover:bg-[var(--ai-lavender)]"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {label}
        </GhostBtn>
      ) : (
        <>
          <Btn
            disabled={disabled}
            onClick={() => void start(eligible)}
            className={
              variant === "primary" ? "" : "hover:bg-[var(--ai-lavender)]"
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            {label}
          </Btn>
          {live ? (
            <p className="text-[12px] text-[var(--brand-muted)]">
              {ESTIMATE_HELP}
            </p>
          ) : null}
        </>
      )}
      {reason}
      {state.running ? (
        <p role="status" className="text-[12px] text-[var(--brand-muted)]">
          {progressText(state.processed, state.total)}
        </p>
      ) : null}
      {state.note ? (
        <p className="text-[12px] text-[var(--brand-muted)]">{state.note}</p>
      ) : null}
      {state.summary ? (
        <p className="text-[12px] text-[var(--brand-muted)]">{state.summary}</p>
      ) : null}
    </div>
  );
}
