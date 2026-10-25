"use client";

// R1-18 (mock 3): "Configura tus costos · n de 4" at the top of Costos. It was
// Menú › Resumen's setup block; the components are the SAME ones, only their
// route changed: the checklist, the cost file (PriceCatalogPanel: chips,
// «Recetas de tu archivo» with Deshacer lote, «Costos por decidir»), the menu
// reader (folded) and «Empezar de nuevo». Their endpoints and handlers are
// unchanged (upload → prepare the dishes, undo a batch, reset). Layout: the page
// shows the KPIs and the tabs first; while setup is incomplete this block is ONE
// compact row («Configura tus costos · 1 de 4 · Siguiente: …» + the next-step
// button + «Ver detalle ▸»), collapsed by default and remembered per company,
// and «Ver detalle» opens the full checklist and «Último archivo» inline. Once
// complete it folds to one line that expands.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CAPABILITY_MESSAGES } from "@/lib/auth/capabilities";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import { IMPORT_RECIPES_BUTTON_ID } from "@/components/restaurant/recipes-costing/RecipeImportPreview";
import type { SetupStep } from "@/lib/restaurant/costing/menu-summary";
import {
  getCachedTab,
  loadTab,
  markTabsStale,
  menuTabKey,
  putTab,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";
import {
  PrepareError,
  prepareDishesFromUpload,
  prepareFailure,
  prepareNotice,
} from "@/lib/restaurant/recipe-costing/prepare-from-upload";
import { MenuReaderPanel } from "@/components/restaurant/recipes-costing/MenuReaderPanel";
import {
  PriceCatalogPanel,
  type PriceCatalogPanelHandle,
} from "@/components/restaurant/recipes-costing/PriceCatalogPanel";
import {
  COSTS_FILE_ANCHOR,
  OPEN_COSTS_PICKER_EVENT,
} from "@/lib/restaurant/costs-picker";
import { ResetPanel } from "@/components/restaurant/recipes-costing/ResetPanel";

async function fetchSetup(
  locationId: string | null
): Promise<RecipeCostingWorkspace | null> {
  const q = new URLSearchParams({ vista: "resumen" });
  if (locationId) q.set("location_id", locationId);
  const res = await fetch(`/api/restaurant/recipes/costing?${q.toString()}`);
  return res.ok ? ((await res.json()) as RecipeCostingWorkspace) : null;
}

export function ageLabel(
  createdAt: string | null | undefined,
  now: number
): string | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  return days === 0
    ? "de hoy"
    : days === 1
      ? "de hace 1 día"
      : `de hace ${days} días`;
}

/** localStorage key: the detail is open or closed, per company. */
export function setupOpenKey(companyId: string | null | undefined): string {
  return `milton:costos:configuracion-abierta:${companyId ?? "sin-empresa"}`;
}

function readOpen(
  companyId: string | null | undefined,
  startOpen: boolean
): boolean {
  if (typeof window === "undefined") return false;
  try {
    // A link to the file card («Subir archivo de costos») opens it.
    if (window.location.hash === "#costos-ultimo-archivo") return true;
    const stored = window.localStorage.getItem(setupOpenKey(companyId));
    return stored === null ? startOpen : stored === "1";
  } catch {
    return startOpen;
  }
}

/** The banner text for the next step: «completar 42 precios» → «Completar 42 precios». */
export function nextStepText(action: string): string {
  const text = action.replace(/^Continuar:\s*/i, "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function CostsSetupSection({
  locationId,
  companyId = null,
  startOpen = false,
}: {
  locationId: string | null;
  companyId?: string | null;
  /** An account with no data yet: the setup IS the next step, so it starts open (unless the person closed it). */
  startOpen?: boolean;
}) {
  const router = useRouter();
  const key = menuTabKey("resumen", { location: locationId });
  const [data, setData] = useState<RecipeCostingWorkspace | null>(
    () => getCachedTab(key)?.data ?? null
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Incomplete setup: «Ver detalle» (collapsed by default, remembered per company).
  const [detailOpen, setDetailOpen] = useState(() =>
    readOpen(companyId, startOpen)
  );
  const setDetail = (next: boolean) => {
    setDetailOpen(next);
    try {
      window.localStorage.setItem(setupOpenKey(companyId), next ? "1" : "0");
    } catch {
      // private mode: it simply is not remembered
    }
  };
  const panelRef = useRef<PriceCatalogPanelHandle>(null);
  // Dishes waiting for «2. Importar recetas» (set by the file card once prices are saved).
  const [importPending, setImportPending] = useState<number | null>(null);
  const goToFileRef = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const json = await fetchSetup(locationId);
    if (json) {
      setData(json);
      putTab(key, json);
    }
    return json;
  }, [locationId, key]);

  useEffect(() => {
    let cancelled = false;
    void loadTab(key, () => fetchSetup(locationId)).then((json) => {
      if (cancelled) return;
      if (json) {
        setData(json);
        setFailed(false);
      } else setFailed((was) => was || getCachedTab(key) === null);
    });
    return () => {
      cancelled = true;
    };
  }, [key, locationId, attempt]);

  // «Subir archivo de costos» elsewhere on this page: same click, same picker.
  useEffect(() => {
    const onOpen = (event: Event) => {
      // Not ready yet (loading / failed): let the link fall through to its
      // #costos-ultimo-archivo href; the mount effect opens the detail then.
      if (!goToFileRef.current) return;
      const detail = (event as CustomEvent<{ handled?: boolean }>).detail;
      if (detail) detail.handled = true;
      goToFileRef.current();
    };
    window.addEventListener(OPEN_COSTS_PICKER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COSTS_PICKER_EVENT, onOpen);
  }, []);

  // Arriving from another page with #costos-ultimo-archivo (no click here, so
  // no picker): open the detail and bring the button into view. The URL is
  // read after a tick because a client-side navigation updates it just after
  // this page mounts.
  useEffect(() => {
    if (!data) return;
    const id = setTimeout(() => {
      if (window.location.hash !== `#${COSTS_FILE_ANCHOR}`) return;
      setDetailOpen(true);
      document
        .getElementById(COSTS_FILE_ANCHOR)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => clearTimeout(id);
  }, [data !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) {
    return failed ? (
      <div
        role="alert"
        className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3 text-[13px]"
      >
        <span className="text-[#c03535]">
          No pude cargar la configuración de costos.
        </span>{" "}
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="font-semibold text-[#1b40c8] underline"
        >
          Reintentar
        </button>
      </div>
    ) : (
      <div
        className="h-[56px] animate-pulse rounded-[14px] bg-[#e9ecf2]"
        aria-busy="true"
        data-testid="costs-setup-loading"
      />
    );
  }
  const summary = data.menu_summary;
  if (!summary) return null;
  const { setup } = summary;

  const onUploaded = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const totals = await prepareDishesFromUpload(setProgress);
      setNotice(prepareNotice(totals));
    } catch (err) {
      setError(
        err instanceof PrepareError
          ? prepareFailure(err)
          : "No pude preparar tus platos desde el archivo."
      );
    } finally {
      markTabsStale();
      await reload().catch(() => undefined);
      setBusy(false);
      setProgress(null);
      router.refresh();
    }
  };
  // Prices saved, recipes still to import: refresh the checklist without
  // restarting the file card.
  const onPricesSaved = () => {
    markTabsStale();
    void reload().catch(() => undefined);
    router.refresh();
  };
  const goToImport = () => {
    setDetail(true);
    setTimeout(() => {
      const button = document.getElementById(IMPORT_RECIPES_BUTTON_ID);
      button?.scrollIntoView({ behavior: "smooth", block: "center" });
      button?.focus({ preventScroll: true });
    }, 50);
  };
  const onResetDone = () => {
    // "Empezar de nuevo" / an import: every panel starts over (upload drafts
    // remount) and the server parts refresh.
    markTabsStale();
    setEpoch((n) => n + 1);
    void reload().catch(() => undefined);
    router.refresh();
  };
  const onUndoBatch = async (batchIds: string[]) => {
    setBusy(true);
    setError(null);
    try {
      // Newest first, so a newer batch never blocks an older one.
      for (const batchId of batchIds) {
        const res = await fetch(
          `/api/restaurant/costs/batches/${batchId}/undo`,
          { method: "POST" }
        );
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "No pude deshacer el lote.");
      }
      markTabsStale();
      await reload();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No pude deshacer el lote."
      );
    } finally {
      setBusy(false);
    }
  };
  // After «1. Guardar precios» the next step is «2. Importar recetas»: the
  // checklist button points at it (not at «revisar 0 platos»).
  const next: SetupStep | null = importPending
    ? {
        id: "excel",
        label: "Importar recetas",
        done: false,
        href: null,
        action: `Continuar: importar recetas (${importPending} ${importPending === 1 ? "plato" : "platos"})`,
      }
    : setup.next;
  const goToFile = () => {
    // The file card lives in the detail: open it, scroll to it and open the
    // picker in this same click (the panel stays mounted, hidden, for that).
    if (!setup.complete) setDetail(true);
    else if (!expanded) setExpanded(true);
    panelRef.current?.openPicker();
    setTimeout(
      () =>
        document
          .getElementById(COSTS_FILE_ANCHOR)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      50
    );
  };
  goToFileRef.current = goToFile;
  const onNext = importPending ? goToImport : goToFile;
  // The server's can("prices.edit") answer (absent in old fixtures = allowed).
  const canEditPrices = data.actor.capabilities?.["prices.edit"] ?? true;
  const more = (
    <MoreMenu
      data={data}
      canEditPrices={canEditPrices}
      onUndoBatch={(ids) => void onUndoBatch(ids)}
      onReset={() => setResetOpen(true)}
    />
  );
  const age = ageLabel(data.latest_upload?.created_at, Date.now());

  if (setup.complete && !expanded && !resetOpen) {
    return (
      <section
        className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[#eef0f4] bg-white px-4 py-2.5 text-[13px]"
        data-testid="costs-setup-folded"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#e7f6ee] text-[12px] font-bold text-[#1f9d55]">
          ✓
        </span>
        <b>Costos configurados</b>
        {data.latest_upload ? (
          <span className="text-[#6b7385]">
            · archivo {age ?? data.latest_upload.filename}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="ml-auto font-semibold text-[#1b40c8] hover:underline"
        >
          Subir nuevo
        </button>
        {more}
      </section>
    );
  }

  return (
    <div className="space-y-3" data-testid="costs-setup">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}
      {progress ? (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          Preparando tus platos desde el archivo…{" "}
          {progress.total
            ? `${Math.min(progress.done, progress.total)} de ${progress.total} platos (los que más venden primero)`
            : "empezando por los platos que más venden"}
        </div>
      ) : notice ? (
        <div className="rounded-lg border border-[#cfe9d9] bg-[#f1faf5] px-3 py-2 text-sm text-[#1f7a45]">
          {notice}
        </div>
      ) : null}

      {!setup.complete ? (
        <section
          className="flex min-h-[48px] max-h-[56px] flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden rounded-[14px] border border-[#dbe3f7] bg-[#f6f8fe] px-4 py-2 text-[13px]"
          data-testid="costs-setup-banner"
        >
          <b className="text-[#151c2c]">
            Configura tus costos · {setup.done} de {setup.total}
          </b>
          {next ? (
            <span className="min-w-0 truncate text-[#4a5a85]">
              · Siguiente: {nextStepText(next.action)}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            {next ? (
              <NextStepButton step={next} onFile={onNext} compact />
            ) : null}
            <button
              type="button"
              aria-expanded={detailOpen}
              onClick={() => setDetail(!detailOpen)}
              className="font-semibold text-[#1b40c8] hover:underline"
            >
              Ver detalle {detailOpen ? "▾" : "▸"}
            </button>
            {more}
          </span>
        </section>
      ) : null}

      {/* Always mounted (hidden while folded) so the file picker can open from
          «Continuar» in the same click. */}
      {
        <div
          className={
            "grid grid-cols-1 gap-3 lg:grid-cols-2" +
            (setup.complete || detailOpen ? "" : " hidden")
          }
          data-testid={
            setup.complete || detailOpen ? "costs-setup-detail" : undefined
          }
        >
          <section className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3.5">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-bold">
                Configura tus costos · {setup.done} de {setup.total}
              </h2>
              {setup.complete ? more : null}
              {setup.complete ? (
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="ml-auto text-[12px] font-semibold text-[#1b40c8]"
                >
                  Plegar
                </button>
              ) : null}
            </div>
            {setup.steps.map((step, index) => (
              <SetupRow
                key={step.id}
                step={step}
                index={index}
                onFile={goToFile}
              />
            ))}
            {next ? (
              <div className="mt-3">
                <NextStepButton step={next} onFile={onNext} />
              </div>
            ) : null}
          </section>

          <section
            id={COSTS_FILE_ANCHOR}
            className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3.5"
          >
            <div className="mb-1 flex items-baseline">
              <h2 className="text-[13px] font-bold">Último archivo</h2>
              {data.latest_upload ? (
                <span className="ml-auto truncate text-[12px] text-[#8a92a3]">
                  {data.latest_upload.filename}
                </span>
              ) : (
                <span className="ml-auto text-[12px] text-[#8a92a3]">
                  Aún no subes uno
                </span>
              )}
            </div>
            <PriceCatalogPanel
              ref={panelRef}
              key={`upload-${epoch}`}
              embedded
              onUploaded={() => void onUploaded()}
              onRecipesImported={onResetDone}
              onPricesSaved={onPricesSaved}
              onImportPending={setImportPending}
              locationId={locationId}
              busyExternal={busy}
              canEditPrices={canEditPrices}
            />
            <details className="mt-2 border-t border-[#f2f3f6] pt-2 text-[13px]">
              <summary className="cursor-pointer text-[#4b5466]">
                ▸ Leer tu menú web (opcional)
              </summary>
              <div className="mt-2">
                <MenuReaderPanel
                  key={`menu-${epoch}`}
                  embedded
                  canEdit={data.actor.can_submit}
                  busyExternal={busy}
                  locationId={locationId}
                  onDone={onResetDone}
                  onEstimated={() => {
                    markTabsStale();
                    router.refresh();
                  }}
                />
              </div>
            </details>
          </section>
        </div>
      }

      {resetOpen && data.reset ? (
        <ResetPanel
          key={`reset-${epoch}`}
          reset={data.reset}
          locationId={locationId}
          initiallyOpen
          onCancel={() => setResetOpen(false)}
          onDone={() => {
            setResetOpen(false);
            onResetDone();
          }}
        />
      ) : null}
    </div>
  );
}

function NextStepButton({
  step,
  onFile,
  compact = false,
}: {
  step: SetupStep;
  onFile: () => void;
  /** In the one-row banner the text says «Continuar»; the step is named next to it. */
  compact?: boolean;
}) {
  const cls =
    "inline-flex items-center rounded-lg bg-[#1b40c8] px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1535a6]" +
    (compact ? " whitespace-nowrap" : "");
  const label = compact ? "Continuar" : step.action;
  if (step.href) {
    return (
      <Link href={step.href} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onFile}>
      {label}
    </button>
  );
}

function SetupRow({
  step,
  index,
  onFile,
}: {
  step: SetupStep;
  index: number;
  onFile: () => void;
}) {
  const body = (
    <>
      <span
        className={
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold " +
          (step.done
            ? "bg-[#e7f6ee] text-[#1f9d55]"
            : "bg-[#eef0f4] text-[#6b7385]")
        }
      >
        {step.done ? "✓" : index + 1}
      </span>
      <span>{step.label}</span>
    </>
  );
  const cls =
    "flex w-full items-center gap-2.5 border-t border-[#f2f3f6] py-2 text-left text-[13px] first:mt-1 hover:text-[#151c2c]";
  if (step.href) {
    return (
      <Link href={step.href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onFile}>
      {body}
      <span className="ml-auto text-[12px] font-semibold text-[#1b40c8]">
        {step.done ? "Subir otro archivo" : "Elegir archivo"}
      </span>
    </button>
  );
}

/** "⋯": undo an upload (one row per file) and "Empezar de nuevo". */
function MoreMenu({
  data,
  canEditPrices,
  onUndoBatch,
  onReset,
}: {
  data: RecipeCostingWorkspace;
  canEditPrices: boolean;
  onUndoBatch: (batchIds: string[]) => void;
  onReset: () => void;
}) {
  if (data.batches.length === 0 && !data.reset) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Más acciones"
          className="ml-1 rounded-md p-1 text-[#6b7385] hover:bg-[#f1f3f7]"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {data.batches.length > 0 ? (
          <>
            <DropdownMenuLabel className="text-[12px] text-[#6b7385]">
              Deshacer una carga
            </DropdownMenuLabel>
            {canEditPrices ? null : (
              <p className="px-2 pb-1 text-[12px] text-[#6b7280]">
                {CAPABILITY_MESSAGES["prices.edit"]}
              </p>
            )}
            {data.batches.map((batch) => (
              <DropdownMenuItem
                key={batch.id}
                disabled={!canEditPrices}
                onClick={() => onUndoBatch(batch.batch_ids)}
              >
                <span className="flex-1 truncate">{batch.filename}</span>
                {batch.uploads > 1 ? (
                  <span className="text-[12px] text-[#8a92a3]">
                    {batch.uploads} cargas
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {data.reset ? (
          <>
            {data.batches.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem className="text-[#c03535]" onClick={onReset}>
              Empezar de nuevo…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
