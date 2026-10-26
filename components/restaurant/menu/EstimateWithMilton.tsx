"use client";

// «Estimar con Milton» (issue #212): the one run flow, used by the menu
// reader (Costos) and by Menú › Platos. It asks the server for estimates in
// chunks (≤5 dishes per call, the best sellers of the month first, 20 at most per run) and
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
  ESTIMATE_NOTHING_TO_DO,
  ESTIMATE_NO_ROLE_HINT,
  ESTIMATE_PROBE_FAILED,
  ESTIMATE_RETRY,
  ESTIMATE_UNAVAILABLE,
  estimateSkipMessage,
} from "./estimate-overlay";
import Link from "next/link";
import { dishHref } from "@/lib/restaurant/menu-links";
import {
  EstimateChunkError,
  remainingNote,
  runEstimateChunks,
  type ChunkResponse,
  type ChunkResult,
  type EstimateRunOutcome,
} from "@/lib/restaurant/menu-reading/estimate-run";

import {
  invalidateEstimateProbe,
  loadEstimateProbe,
} from "@/lib/restaurant/menu-estimate-probe-cache";

const ENDPOINT = "/api/restaurant/recipes/menu/estimate";
export const MAX_DISHES_PER_RUN = 20;

export interface EstimateRunState {
  running: boolean;
  /** Dishes handled so far (estimated or skipped). */
  processed: number;
  total: number;
  note: string | null;
  summary: string | null;
  /** Every plato handled by the last run, in the order the server returned. */
  results: ChunkResult[];
  /** Platos still without an estimate after the run (null = unknown). */
  remaining: number | null;
}

export function estimateSummary(estimated: number, skipped: number): string {
  const base = `Listo: ${estimated} ${estimated === 1 ? "plato estimado" : "platos estimados"}.`;
  if (skipped <= 0) return base;
  return `${base} ${skipped} ${skipped === 1 ? "plato quedó" : "platos quedaron"} sin estimar.`;
}

export function progressText(processed: number, total: number): string {
  return `Estimando ${Math.min(processed, total)} de ${total} platos…`;
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
    results: [],
    remaining: null,
  });
  const runningRef = useRef(false);

  async function start(eligible: number | null) {
    if (runningRef.current) return;
    runningRef.current = true;
    const total = Math.max(
      1,
      Math.min(MAX_DISHES_PER_RUN, eligible && eligible > 0 ? eligible : 20)
    );
    setState({
      running: true,
      processed: 0,
      total,
      note: null,
      summary: null,
      results: [],
      remaining: null,
    });
    let outcome: EstimateRunOutcome = {
      results: [],
      estimated: 0,
      skipped: 0,
      remaining: null,
      note: null,
    };
    try {
      outcome = await runEstimateChunks({
        total,
        missingTableNote: ESTIMATE_MISSING_TABLE,
        onProgress: (processed) => setState((prev) => ({ ...prev, processed })),
        post: async (limit) => {
          const res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              location_id: locationId ?? undefined,
              limit,
            }),
          });
          const json = (await res.json().catch(() => ({}))) as ChunkResponse;
          if (!res.ok)
            throw new EstimateChunkError(res.status, json.error ?? undefined);
          return json;
        },
      });
    } finally {
      runningRef.current = false;
      // The counts changed (or may have): the next check reads again.
      invalidateEstimateProbe();
      setState({
        running: false,
        processed: outcome.results.length,
        total,
        note: outcome.note,
        summary: outcome.note
          ? null
          : estimateSummary(outcome.estimated, outcome.skipped),
        results: outcome.results,
        remaining: outcome.remaining,
      });
    }
    if (outcome.estimated > 0) onDone();
  }

  return { state, start };
}

const LINK_CLASS =
  "font-semibold text-[var(--brand-blue)] hover:text-[#1533A3] hover:underline";

/**
 * The plato names of a run, each linking to its plato; the skipped ones with
 * the short reason. Compact: the first 5, then «Ver todos».
 */
export function EstimateRunList({ results }: { results: ChunkResult[] }) {
  const [all, setAll] = useState(false);
  const ordered = [
    ...results.filter((r) => !r.skipped_reason),
    ...results.filter((r) => r.skipped_reason),
  ].filter((r) => r.menu_item_id || r.skipped_reason);
  if (ordered.length === 0) return null;
  const shown = all ? ordered : ordered.slice(0, 5);
  return (
    <div data-testid="estimate-run-list" className="space-y-1">
      <ul className="space-y-0.5 text-[12px] text-[var(--brand-muted)]">
        {shown.map((r, i) => {
          const name = r.name?.trim() || "Plato sin nombre";
          return (
            <li key={`${r.menu_item_id}-${i}`}>
              {r.odoo_product_id != null ? (
                <Link href={dishHref(r.odoo_product_id)} className={LINK_CLASS}>
                  {name}
                </Link>
              ) : (
                <span className="font-semibold text-[var(--brand-ink)]">
                  {name}
                </span>
              )}
              {r.skipped_reason ? (
                <span> · {estimateSkipMessage(r.skipped_reason)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!all && ordered.length > 5 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={LINK_CLASS + " text-[12px]"}
        >
          Ver todos ({ordered.length})
        </button>
      ) : null}
    </div>
  );
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
  | { status: "ok"; available: boolean; eligible: number };

/**
 * The button (or a small link) with its progress and summary. It always
 * renders: without `recipes.edit`, with estimates not active, with nothing to
 * estimate or with a failed check it is disabled and says why, never hidden.
 * `onVisibleChange` tells a card when the run button is live (so it can keep
 * a single primary button).
 */
export function EstimateWithMilton({
  canEdit,
  companyId,
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
  /** The active company (keys the cached check; none = never cached). */
  companyId?: string | null;
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
        const json = await loadEstimateProbe(
          companyId,
          locationId,
          async () => {
            const res = await fetch(`${ENDPOINT}${q}`);
            if (!res || !res.ok) throw new Error("probe");
            return (await res.json()) as {
              available?: boolean;
              eligible?: number;
            };
          }
        );
        if (!cancelled)
          setProbe({
            status: "ok",
            available: json.available === true,
            eligible: Number(json.eligible ?? 0),
          });
      } catch {
        if (!cancelled) setProbe({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, companyId, locationId, attempt]);

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
              invalidateEstimateProbe();
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
          {ESTIMATE_NOTHING_TO_DO}
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
      {state.summary && !state.running ? (
        <EstimateRunList results={state.results} />
      ) : null}
      {state.summary && !state.running && remainingNote(state.remaining) ? (
        <p className="text-[12px] text-[var(--brand-muted)]">
          {remainingNote(state.remaining)}
        </p>
      ) : null}
    </div>
  );
}
