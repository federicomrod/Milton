"use client";

// R1-18 (mock 3): "Configura tus costos · n de 4" at the top of Costos. It was
// Menú › Resumen's setup block; the components are the SAME ones, only their
// route changed: the checklist, the cost file (PriceCatalogPanel: chips,
// «Recetas de tu archivo» with Deshacer lote, «Costos por decidir»), the menu
// reader (folded) and «Empezar de nuevo». Their endpoints and handlers are
// unchanged (upload → prepare the dishes, undo a batch, reset). Once complete
// it folds to one line that expands.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
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
import { PriceCatalogPanel } from "@/components/restaurant/recipes-costing/PriceCatalogPanel";
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

export function CostsSetupSection({
  locationId,
}: {
  locationId: string | null;
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
        className="h-[240px] animate-pulse rounded-[14px] bg-[#e9ecf2]"
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
  const goToFile = () =>
    document
      .getElementById("costos-ultimo-archivo")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  const more = (
    <MoreMenu
      data={data}
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

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-3.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-bold">
              Configura tus costos · {setup.done} de {setup.total}
            </h2>
            {more}
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
          {setup.next ? (
            <div className="mt-3">
              <NextStepButton step={setup.next} onFile={goToFile} />
            </div>
          ) : null}
        </section>

        <section
          id="costos-ultimo-archivo"
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
            key={`upload-${epoch}`}
            embedded
            onUploaded={() => void onUploaded()}
            onRecipesImported={onResetDone}
            locationId={locationId}
            busyExternal={busy}
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
              />
            </div>
          </details>
        </section>
      </div>

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
}: {
  step: SetupStep;
  onFile: () => void;
}) {
  const cls =
    "inline-flex items-center rounded-lg bg-[#1b40c8] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]";
  if (step.href) {
    return (
      <Link href={step.href} className={cls}>
        {step.action}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onFile}>
      {step.action}
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
  onUndoBatch,
  onReset,
}: {
  data: RecipeCostingWorkspace;
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
            {data.batches.map((batch) => (
              <DropdownMenuItem
                key={batch.id}
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
