"use client";

// R1-17b (mocks 1, 2, 4): Ventas › Detalle. ONE request loads the cube of the
// restaurant in view; after that every filter, comparison, click and tab is
// computed here (lib/restaurant/sales-detail.ts), well under 300 ms and with
// no reload. The whole state lives in the URL.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  computeDetail,
  DEFAULT_STATE,
  prepareCube,
  serializeDetailState,
  toggleToken,
  resolveRange,
  type DetailState,
} from "@/lib/restaurant/sales-detail";
import { parseDetailCube } from "@/lib/restaurant/sales-detail-cube";
import type { SalesDetailPayload } from "@/lib/restaurant/sales-detail-server";
import { SHIFTS_HREF } from "@/lib/restaurant/navigation";
import { FilterBar } from "./FilterBar";
import { KpiRow } from "./KpiRow";
import { DailyChart } from "./DailyChart";
import { ShiftCards } from "./ShiftCards";
import { DetailHeatmap } from "./DetailHeatmap";
import { DimensionPanel } from "./DimensionPanel";
import { PlatosTab } from "./PlatosTab";
import { dayLabelEs, moneyFmt, rangeLabelEs } from "./format";

const PAGE_KEYS = [
  "tab",
  "dim",
  "vista",
  "p",
  "desde",
  "hasta",
  "cmp",
  "canal",
  "pago",
  "cat",
  "turno",
  "dia",
  "hora",
  "graf",
  "mapa",
  "cruzar",
];

type Loaded = Omit<SalesDetailPayload, "cube"> & {
  cube: NonNullable<ReturnType<typeof parseDetailCube>>;
};

export function SalesDetailV2({
  initial,
  locationId,
}: {
  initial: DetailState;
  locationId: string | null;
}) {
  const [state, setState] = useState<DetailState>(initial);
  const [attempt, setAttempt] = useState(0);
  // The answer of the request that is current (keyed, so a new request never
  // shows the old answer and no state is reset inside an effect).
  const requestKey = `${locationId ?? ""}|${attempt}`;
  const [answer, setAnswer] = useState<{
    key: string;
    data?: Loaded;
    error?: string;
  } | null>(null);
  const current = answer && answer.key === requestKey ? answer : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams();
    if (locationId) q.set("location_id", locationId);
    fetch(`/api/restaurant/sales-detail${q.size ? `?${q.toString()}` : ""}`)
      .then(async (res) => {
        const json = (await res
          .json()
          .catch(() => ({}))) as SalesDetailPayload & { error?: string };
        if (!res.ok)
          throw new Error(json.error ?? "No pude cargar las ventas.");
        const cube = parseDetailCube(json.cube);
        if (!cube)
          throw new Error("Las ventas llegaron en un formato que no entiendo.");
        return { ...json, cube } as Loaded;
      })
      .then((d) => !cancelled && setAnswer({ key: requestKey, data: d }))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setAnswer({
            key: requestKey,
            error:
              e instanceof Error ? e.message : "No pude cargar las ventas.",
          })
      );
    return () => {
      cancelled = true;
    };
  }, [locationId, requestKey]);

  const prepared = useMemo(
    () => (data ? prepareCube(data.cube) : null),
    [data]
  );
  const scope = useMemo(
    () => ({
      locationId,
      restaurantIds: (data?.restaurants ?? []).map((r) => r.id),
    }),
    [locationId, data]
  );
  const view = useMemo(
    () =>
      prepared && data
        ? computeDetail({
            prepared,
            state,
            targets: data.targets,
            scope,
            shiftsVisible: data.shiftsVisible,
          })
        : null,
    [prepared, data, state, scope]
  );

  const update = useCallback((patch: Partial<DetailState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try {
        const url = new URL(window.location.href);
        for (const k of PAGE_KEYS) url.searchParams.delete(k);
        for (const [k, v] of serializeDetailState(next))
          url.searchParams.set(k, v);
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`
        );
      } catch {
        // no URL sync (private window, tests): the page still works
      }
      return next;
    });
  }, []);

  if (error)
    return (
      <div
        role="alert"
        className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-6 text-[13px]"
      >
        <p className="text-[#c03535]">{error}</p>
        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="mt-2 rounded-lg bg-[#1b40c8] px-3 py-1.5 text-[12.5px] font-semibold text-white"
        >
          Reintentar
        </button>
      </div>
    );
  if (!data || !prepared)
    return (
      <div
        className="space-y-3"
        aria-busy="true"
        data-testid="sales-detail-loading"
      >
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-[#e9ecf2]" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[14px] bg-[#e9ecf2]"
            />
          ))}
        </div>
        <div className="h-56 animate-pulse rounded-[14px] bg-[#e9ecf2]" />
      </div>
    );
  if (!view || data.cube.rows.length === 0)
    return (
      <p className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-8 text-center text-[13px] text-[#6b7385]">
        Aún no hay ventas para explorar.{" "}
        <a
          href="/dashboard/restaurant/data?seccion=conexiones#conexiones"
          className="font-semibold text-[#1b40c8] underline"
        >
          Importar ventas del POS →
        </a>
      </p>
    );

  const money = moneyFmt(data.currency);
  const resolved = resolveRange(state, data.cube);
  const lastDay = data.cube.last_day;
  const onTile =
    (patchKey: "categories" | "channels" | "payments" | "shifts") =>
    (token: string, multi: boolean) =>
      update({
        [patchKey]: toggleToken(state[patchKey], token, multi),
      } as Partial<DetailState>);
  const dimKey = {
    categoria: "categories",
    canal: "channels",
    pago: "payments",
    turno: "shifts",
  } as const;
  const anyDim =
    state.channels.length + state.payments.length + state.shifts.length > 0;

  return (
    <div className="space-y-3" data-testid="sales-detail">
      <FilterBar
        state={state}
        cube={data.cube}
        shiftsVisible={data.shiftsVisible}
        lastDay={lastDay}
        onChange={(patch) => {
          // «Personalizado» starts from the period on screen.
          if (patch.period === "custom" && !patch.from && !state.from)
            return update({
              ...patch,
              from: view.range.from,
              to: view.range.to,
            });
          update(patch);
        }}
      />
      <p
        className="text-[11.5px] text-[#8a92a3]"
        data-testid="sales-detail-note"
      >
        {rangeLabelEs(view.range.from, view.range.to)} · {view.days}{" "}
        {view.days === 1 ? "día" : "días"} · comparado con {view.compare.label}
        {view.compare.baseline
          ? ` (${rangeLabelEs(view.compare.baseline.range.from, view.compare.baseline.range.to)}${view.compare.baseline.note ? `, ${view.compare.baseline.note}` : ""})`
          : " (sin período comparable: «—»)"}
        {lastDay ? ` · datos hasta ${dayLabelEs(lastDay)}` : ""}
        {view.clipped || (resolved && resolved.clipped)
          ? " · el período se recortó a lo que hay cargado"
          : ""}
      </p>

      {state.tab === "tendencia" ? (
        <>
          <KpiRow view={view} currency={data.currency} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
            <div className="space-y-3">
              <DailyChart
                bars={view.daily}
                metric={state.chart}
                money={(n) => money(n)}
                hasTarget={view.dailyTarget}
                onMetric={(chart) => update({ chart })}
                onDay={(date) =>
                  update({ period: "custom", from: date, to: date })
                }
              />
              {view.shiftCards ? (
                <ShiftCards
                  cards={view.shiftCards}
                  hours={data.shiftHours}
                  selected={state.shifts}
                  money={money}
                  onToggle={(name, multi) =>
                    update({ shifts: toggleToken(state.shifts, name, multi) })
                  }
                />
              ) : data.noShifts ? (
                <p className="text-[12px] text-[#6b7385]">
                  Aún no tienes turnos.{" "}
                  <a
                    href={SHIFTS_HREF}
                    className="font-semibold text-[#1b40c8] hover:underline"
                  >
                    Define tus turnos
                  </a>{" "}
                  para ver las ventas de almuerzo, cena y más.
                </p>
              ) : null}
            </div>
            <DetailHeatmap
              grid={view.heat}
              cross={view.cross}
              metric={state.heat}
              crossKey={state.cross}
              selectedDays={state.weekdays}
              selectedHours={state.hours}
              money={money}
              onMetric={(heat) => update({ heat })}
              onCross={(cross) => update({ cross })}
              onCell={(wd, h) =>
                update(
                  state.weekdays.length === 1 &&
                    state.weekdays[0] === wd &&
                    state.hours.length === 1 &&
                    state.hours[0] === h
                    ? { weekdays: [], hours: [] }
                    : { weekdays: [wd], hours: [h] }
                )
              }
            />
          </div>
        </>
      ) : state.tab === "desglose" ? (
        <DimensionPanel
          view={view}
          dim={state.dim}
          mode={state.view}
          money={money}
          shiftsVisible={data.shiftsVisible}
          compareShort={view.compare.short}
          onDim={(dim) => update({ dim })}
          onMode={(v) => update({ view: v })}
          onToggle={onTile(dimKey[state.dim])}
          onClear={() =>
            update({ [dimKey[state.dim]]: [] } as Partial<DetailState>)
          }
          onSeeDishes={(token) =>
            update(
              token ? { tab: "platos", categories: [token] } : { tab: "platos" }
            )
          }
        />
      ) : (
        <PlatosTab
          range={view.range}
          locationId={locationId}
          restaurants={data.restaurants}
          categories={state.categories}
          channelsActive={anyDim}
          money={money}
        />
      )}
    </div>
  );
}

export { DEFAULT_STATE };
