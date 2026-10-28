// components/restaurant/rentabilidad/RentabilidadPage.tsx
//
// Rentabilidad (#400): is the restaurant making money this month? The top half
// uses the same header, controls, cards and chart style as the Cockpit and
// Ventas; every number comes from rentabilidad.ts. Spanish only.
//
// Colours (brand): blue #1B40C8 (hover #1533A3, tint #E7EDFD); Ink #0F172A on
// mint #A7F3D0 (good), rosa #FBCFE8 (bad) and amarillo #FDE68A (alerts);
// lavender #D8D0F8 ONLY for a Milton estimate; #E5E7EB for borders only.
// Changing the month keeps the previous view on screen (no spinner).

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { formatMoney } from "@/lib/restaurant/costs-format";
import { costsTabHref } from "@/lib/restaurant/costs-tabs";
import { dishHref, platosHref } from "@/lib/restaurant/menu-links";
import { SALES_HREF, withShellParams } from "@/lib/restaurant/navigation";
import { CATEGORY_LABELS_ES } from "@/lib/restaurant/fixed-costs";
import type { RentabilidadPageData } from "@/lib/restaurant/rentabilidad-server";
import type { Cada100Part, UncoveredDish } from "@/lib/restaurant/rentabilidad";
import {
  chipTexts,
  dayLabelEs,
  findingText,
  heroSentence,
  monthLabelEs,
  monthNameEs,
  pctText,
  pointsText,
  weekdayEs,
} from "@/lib/restaurant/rentabilidad-copy";
import { RaceChart } from "@/components/restaurant/rentabilidad/RaceChart";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { StatCard } from "@/components/restaurant/ui/StatCard";

// Brand colours: the one place.
const PRIMARY = "#1B40C8";
const INK = "#0F172A";
const GOOD_FILL = "#A7F3D0";
const BAD_FILL = "#FBCFE8";
const AI_FILL = "#D8D0F8";

const BTN =
  "inline-flex items-center justify-center rounded-md bg-[#1B40C8] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2";
const ALERT_PILL =
  "inline-block rounded-full bg-[#FDE68A] px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]";
const SEGMENT_GROUP =
  "inline-flex flex-wrap rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold";
const segmentBtn = (active: boolean) =>
  "rounded-[9px] px-3.5 py-1.5 " +
  (active
    ? "bg-[#1b40c8] text-white shadow-sm"
    : "text-[#4a5a85] hover:text-[#1b40c8]");

const PART_LABEL: Record<Cada100Part["key"], string> = {
  comida: "Comida y bebida",
  merma: "Merma no planeada",
  impuestos: "Impuestos",
  planilla: "Planilla",
  alquiler: "Alquiler",
  servicios: "Servicios",
  otros: "Otros",
  ganancia: "Ganancia",
};
const PART_COLOR: Record<Cada100Part["key"], string> = {
  comida: "#1B40C8",
  impuestos: "#A9B8EE",
  merma: BAD_FILL,
  planilla: "#4F6BD6",
  alquiler: "#7F93E3",
  servicios: "#C3CEF4",
  otros: "#E7EDFD",
  ganancia: GOOD_FILL,
};

const CHIP_TONE = {
  good: "bg-[#A7F3D0] text-[#0F172A]",
  bad: "bg-[#FBCFE8] text-[#0F172A]",
  neutral: "bg-[#E7EDFD] text-[#1B40C8]",
} as const;

function ProfitBadges({
  value,
  estimate,
}: {
  value: number;
  estimate: boolean;
}) {
  return (
    <>
      <span
        className={
          "rounded-full px-2 py-0.5 text-[12px] font-semibold " +
          (value >= 0 ? CHIP_TONE.good : CHIP_TONE.bad)
        }
      >
        {value >= 0 ? "Ganancia" : "Pérdida"}
      </span>
      {estimate ? (
        <span
          className="rounded-full px-2 py-0.5 text-[12px] font-semibold text-[#0F172A]"
          style={{ background: AI_FILL }}
        >
          Estimado por Milton
        </span>
      ) : null}
    </>
  );
}

export function RentabilidadPage({
  data,
  locationId,
  locationName,
  months,
  currentMonth,
}: {
  data: RentabilidadPageData;
  locationId: string;
  locationName: string | null;
  /** The month picker: the current month and the 2 before it. */
  months: string[];
  currentMonth: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"resumen" | "por-dia">("resumen");
  const m = data.month;
  const money = useMemo(
    () => (n: number) => formatMoney(n, data.currency),
    [data.currency]
  );
  const base = "/dashboard/restaurant/rentabilidad";
  const hrefFor = (month: string) =>
    `${base}?${new URLSearchParams({ location: locationId, month }).toString()}`;

  // Warm the three months of the picker so a click shows the page right away.
  useEffect(() => {
    for (const month of months) router.prefetch(hrefFor(month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months.join("|"), locationId]);

  const goto = (month: string) =>
    startTransition(() => router.push(hrefFor(month)));

  const fixedHref = costsTabHref("costos-fijos", {
    location: locationId,
    month: m.month,
  });
  const salesHref = withShellParams(SALES_HREF, { locationId });
  const platos = withShellParams(platosHref(), { locationId });
  const estimada = m.basis === "estimada";
  const fixedMissing = m.fixed.total === null;
  const showFlag =
    m.hasData &&
    m.coverage.uncovered.length > 0 &&
    m.coverage.uncoveredPct >= 0.0005;
  const chips = chipTexts(data.chips, m.month, money);
  const findings = data.findings
    .map((f) => findingText(f, m, money))
    .filter(Boolean);
  const chipNodes = chips.length ? (
    <>
      {chips.map((c) => (
        <span
          key={c.text}
          className={
            "rounded-full px-2 py-0.5 text-[12px] font-semibold " +
            CHIP_TONE[c.tone]
          }
        >
          {c.text}
        </span>
      ))}
    </>
  ) : undefined;
  const be = m.breakEvenDay;

  return (
    <div
      className={
        "w-full space-y-3 px-6 py-3 lg:px-10 " +
        (pending ? "opacity-70 transition-opacity" : "transition-opacity")
      }
      aria-busy={pending}
    >
      <OperatingPageHeader title="Rentabilidad" showDateRange={false} />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Mes" className={SEGMENT_GROUP}>
          {months.map((month) => {
            const active = month === m.month;
            return (
              <button
                key={month}
                type="button"
                onClick={() => goto(month)}
                aria-pressed={active}
                className={segmentBtn(active)}
              >
                {month === currentMonth
                  ? `${capitalize(monthNameEs(month))} (este mes)`
                  : capitalize(monthNameEs(month))}
              </button>
            );
          })}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px] text-[#4a5a85] hover:bg-[#E7EDFD]">
          <span>Elegir mes</span>
          <input
            type="month"
            max={currentMonth.slice(0, 7)}
            value={m.month.slice(0, 7)}
            onChange={(e) =>
              e.target.value ? goto(`${e.target.value}-01`) : undefined
            }
            className="w-[8.5rem] bg-transparent font-bold text-[#1b2333] outline-none"
            aria-label="Elegir mes"
          />
        </label>
        <span className="ml-auto text-[12px] text-[#8a92a3]">
          {locationName ? `${locationName} · ` : ""}
          {m.isCurrentMonth
            ? `Datos hasta ayer (${dayLabelEs(addDay(data.today, -1))})`
            : monthLabelEs(m.month)}
        </span>
      </div>

      {!m.hasData ? (
        <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4 text-[14px] font-bold leading-snug text-[#1b2333]">
          {heroSentence(m, money)}
        </section>
      ) : (
        <>
          <p className="text-[14px] font-bold leading-snug text-[#1b2333]">
            {heroSentence(m, money)}
          </p>

          {fixedMissing ? (
            <section
              aria-label="Costos fijos faltantes"
              className="rounded-[14px] border border-[#FDE68A] bg-[#FDE68A]/40 p-4"
            >
              <p className="inline-block rounded-lg bg-[#FDE68A] px-2.5 py-1 text-[14px] font-bold text-[#0F172A]">
                ⚑ Faltan costos fijos: sin ellos no se puede calcular tu
                ganancia ni tu punto de equilibrio.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {m.fixed.missing.map((cat) => (
                  <li key={cat} className={ALERT_PILL}>
                    ⚑ Falta {CATEGORY_LABELS_ES[cat]}
                  </li>
                ))}
              </ul>
              <Link href={fixedHref} className={BTN + " mt-3"}>
                Sube tus costos fijos
              </Link>
            </section>
          ) : null}

          {showFlag ? (
            <CoverageFlag
              uncoveredPct={m.coverage.uncoveredPct}
              uncovered={m.coverage.uncovered}
              moreHref={platos}
              locationId={locationId}
            />
          ) : null}

          {!fixedMissing && m.profit !== null ? (
            <section
              aria-label="Ganancia"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {m.isCurrentMonth && m.profitToDate !== null ? (
                <StatCard
                  label={
                    estimada
                      ? "Ganancia estimada hasta ayer"
                      : "Ganancia real hasta ayer"
                  }
                  value={signed(m.profitToDate, money)}
                  badge={
                    <ProfitBadges value={m.profitToDate} estimate={estimada} />
                  }
                  note="Margen acumulado menos los costos fijos de todo el mes"
                />
              ) : null}
              <StatCard
                label={
                  m.isCurrentMonth
                    ? estimada
                      ? "Proyección estimada al cierre"
                      : "Proyección al cierre"
                    : estimada
                      ? "Ganancia estimada del mes"
                      : "Ganancia real del mes"
                }
                value={signed(m.profit, money)}
                badge={<ProfitBadges value={m.profit} estimate={estimada} />}
                sub={
                  m.profitPct === null
                    ? undefined
                    : `${pctText(m.profitPct)} de tus ventas${
                        m.isCurrentMonth ? " · proyección" : ""
                      }`
                }
                chips={chipNodes}
              />
            </section>
          ) : null}

          <div role="tablist" aria-label="Vista" className={SEGMENT_GROUP}>
            {(
              [
                ["resumen", "Resumen"],
                ["por-dia", "Por día"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={segmentBtn(tab === id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "resumen" ? (
            <div className="space-y-3">
              {!fixedMissing ? (
                <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                    <h2 className="text-[14px] font-bold text-[#1b2333]">
                      ¿Ya cubriste tus costos fijos?
                    </h2>
                    <span className="text-[12px] text-[#8a92a3]">
                      {be
                        ? `Equilibrio: ${dayLabelEs(be.date)}${
                            be.projected ? " (proyección)" : ""
                          }`
                        : "Aún no cubres tus costos fijos este mes"}
                    </span>
                  </div>
                  <RaceChart month={m} money={money} />
                </section>
              ) : null}

              <section
                className="grid grid-cols-2 gap-3 lg:grid-cols-4"
                aria-label="Indicadores"
              >
                <Kpi
                  label="Venta de equilibrio por día"
                  value={
                    m.breakEvenPerDay !== null ? money(m.breakEvenPerDay) : "—"
                  }
                  sub={
                    m.breakEvenPerDay === null
                      ? fixedMissing
                        ? "⚑ Falta cargar tus costos fijos"
                        : "Sin margen para calcularla"
                      : m.avgSalesPerDay !== null
                        ? `vendes ${money(m.avgSalesPerDay)} en promedio`
                        : undefined
                  }
                  flag={m.breakEvenPerDay === null && fixedMissing}
                />
                <Kpi
                  label="Costo primo"
                  value={m.costoPrimo !== null ? pctText(m.costoPrimo) : "—"}
                  sub={
                    m.costoPrimo === null
                      ? "⚑ Falta la planilla"
                      : "comida, merma y planilla ÷ ventas"
                  }
                  flag={m.costoPrimo === null}
                />
                <Kpi
                  label="Planilla"
                  value={m.planillaPct !== null ? pctText(m.planillaPct) : "—"}
                  sub={
                    m.fixed.amounts.planilla !== null
                      ? money(m.fixed.amounts.planilla)
                      : "⚑ Falta"
                  }
                  flag={m.fixed.amounts.planilla === null}
                />
                <Kpi
                  label="Costos fijos del mes"
                  value={m.fixed.total !== null ? money(m.fixed.total) : "—"}
                  sub={
                    m.fixed.total === null ? "⚑ Faltan costos fijos" : undefined
                  }
                  flag={m.fixed.total === null}
                />
              </section>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <section className="rounded-[14px] border border-[#dbe3f7] bg-white p-4 lg:col-span-2">
                  <h2 className="mb-3 text-[14px] font-bold text-[#1b2333]">
                    ¿A dónde va cada $100 que vendes?
                  </h2>
                  {m.cada100 ? (
                    <Cada100Bar parts={m.cada100} loss={m.cada100Loss} />
                  ) : (
                    <p className="text-sm">
                      <span className={ALERT_PILL}>
                        ⚑ Falta cargar tus costos fijos para repartir tus
                        ventas.
                      </span>
                    </p>
                  )}
                </section>
                <section
                  className="rounded-[14px] p-4"
                  style={{ background: "#E7EDFD" }}
                  aria-label="Milton"
                >
                  <h2
                    className="mb-1 text-[14px] font-bold"
                    style={{ color: PRIMARY }}
                  >
                    ✦ Milton
                  </h2>
                  {findings.length > 0 ? (
                    findings.map((f) => (
                      <p
                        key={f}
                        className="text-sm leading-snug"
                        style={{ color: INK }}
                      >
                        {f}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm leading-snug" style={{ color: INK }}>
                      {m.breakEvenPerDay === null
                        ? "Cuando cargues tus costos fijos te digo qué días te cuestan más."
                        : "Todos tus días venden por encima de lo que necesitas."}
                    </p>
                  )}
                </section>
              </div>

              <StatementTable
                data={data}
                money={money}
                links={{ sales: salesHref, platos, fixed: fixedHref }}
              />
            </div>
          ) : (
            <DailyTable data={data} money={money} />
          )}
        </>
      )}
    </div>
  );
}

function addDay(date: string, delta: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + delta)).toISOString().slice(0, 10);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function signed(n: number, money: (n: number) => string): string {
  return n < 0 ? `−${money(Math.abs(n))}` : money(n);
}

function Kpi({
  label,
  value,
  sub,
  flag,
}: {
  label: string;
  value: string;
  sub?: string;
  flag?: boolean;
}) {
  return (
    <div className="rounded-[14px] border border-[#dbe3f7] bg-white p-3">
      <p className="text-xs font-semibold text-[#6b7385]">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums text-[#0f1b3d]">
        {value}
      </p>
      {sub ? (
        <p className={"text-xs " + (flag ? "" : "text-[#6b7385]")}>
          {flag ? <span className={ALERT_PILL}>{sub}</span> : sub}
        </p>
      ) : null}
    </div>
  );
}

const REASON_LABEL: Record<UncoveredDish["reason"], string> = {
  borrador: "Receta en borrador",
  sin_receta: "Sin receta",
  sin_precio: "Sin precio",
};

function CoverageFlag({
  uncoveredPct,
  uncovered,
  moreHref,
  locationId,
}: {
  uncoveredPct: number;
  uncovered: UncoveredDish[];
  moreHref: string;
  locationId: string;
}) {
  const shown = uncovered.slice(0, 6);
  return (
    <section
      role="alert"
      aria-label="Falta el costo de ingredientes"
      className="rounded-[14px] border border-[#FDE68A] bg-[#FDE68A]/40 p-4"
    >
      <p className="inline-block rounded-lg bg-[#FDE68A] px-2.5 py-1 text-[14px] font-bold leading-snug text-[#0F172A]">
        ⚑ Falta el costo de ingredientes del {pctText(uncoveredPct)} de tus
        ventas: aprueba estas recetas
      </p>
      <ul className="mt-3 space-y-2">
        {shown.map((d) => {
          const label =
            d.reason === "sin_precio"
              ? "Completar precio"
              : d.hasDraft
                ? "Aprobar"
                : "Crear receta";
          return (
            <li
              key={d.odooProductId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#0f1b3d]">
                  {d.name}
                </p>
                <p className="text-xs text-[#6b7385]">
                  {pctText(d.share)} de tus ventas · {REASON_LABEL[d.reason]}
                </p>
              </div>
              <Link
                href={withShellParams(dishHref(d.odooProductId), {
                  locationId,
                })}
                className={BTN}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      {uncovered.length > shown.length ? (
        <Link
          href={moreHref}
          className="mt-2 inline-block text-sm font-semibold text-[#1B40C8] underline"
        >
          y {uncovered.length - shown.length} platos más →
        </Link>
      ) : null}
    </section>
  );
}

function Cada100Bar({ parts, loss }: { parts: Cada100Part[]; loss: boolean }) {
  return (
    <div>
      <div
        className="flex h-8 w-full gap-[2px] overflow-hidden rounded-md bg-white"
        role="img"
        aria-label="Reparto de cada $100 de ventas"
      >
        {parts
          .filter((p) => p.pct > 0)
          .map((p) => (
            <div
              key={p.key}
              style={{ width: `${p.pct}%`, background: PART_COLOR[p.key] }}
              title={`${PART_LABEL[p.key]} ${pointsText(p.pct)}`}
            />
          ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {parts.map((p) => (
          <li
            key={p.key}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="flex items-center gap-2 text-[#0f1b3d]">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: PART_COLOR[p.key] }}
                aria-hidden
              />
              {p.key === "ganancia" ? "Ganancia" : PART_LABEL[p.key]}
            </span>
            <span className="font-semibold tabular-nums text-[#0f1b3d]">
              ${p.pct.toFixed(1).replace(".", ",")}
            </span>
          </li>
        ))}
      </ul>
      {loss ? (
        <p className="mt-2">
          <span className="inline-block rounded-full bg-[#FBCFE8] px-2.5 py-0.5 text-sm font-semibold text-[#0F172A]">
            Tus costos pasan de $100: este mes hay pérdida.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function StatementTable({
  data,
  money,
  links,
}: {
  data: RentabilidadPageData;
  money: (n: number) => string;
  links: { sales: string; platos: string; fixed: string };
}) {
  const m = data.month;
  const twoCols = m.projection !== null;
  const a = m.actual;
  const p = m.monthTotals;
  const fx = m.fixed.amounts;
  const cell = (n: number | null, neg = false) =>
    n === null ? (
      <span className={ALERT_PILL}>⚑ Falta</span>
    ) : (
      <span className={neg ? "text-[#0f1b3d]" : ""}>{signed(n, money)}</span>
    );
  type Row = {
    label: string;
    href?: string;
    strong?: boolean;
    soon?: boolean;
    values: [React.ReactNode, React.ReactNode];
  };
  const out = (n: number) => cell(-n === 0 ? 0 : -n);
  const rows: Row[] = [
    {
      label: "Ventas netas",
      href: links.sales,
      values: [cell(a.sales), cell(p.sales)],
    },
    {
      label: m.impuestosUndefined
        ? "Impuestos (sin definir: se calcula con 0%)"
        : "Impuestos",
      href: links.fixed,
      values: [out(a.impuestos), out(p.impuestos)],
    },
    {
      label: "Comida y bebida",
      href: links.platos,
      values: [out(a.food), out(p.food)],
    },
    {
      label: "Merma no planeada",
      soon: true,
      values: ["Disponible pronto", "Disponible pronto"],
    },
    {
      label: "Margen bruto",
      strong: true,
      values: [cell(a.margin), cell(p.margin)],
    },
    ...(["planilla", "alquiler", "servicios", "otros"] as const).map(
      (cat): Row => ({
        label: CATEGORY_LABELS_ES[cat],
        href: links.fixed,
        values: [
          cell(fx[cat] === null ? null : -(fx[cat] as number)),
          cell(fx[cat] === null ? null : -(fx[cat] as number)),
        ],
      })
    ),
    {
      label: estimadaLabel(m.basis, "Ganancia"),
      strong: true,
      values: [
        m.profitToDate === null ? cell(null) : cell(m.profitToDate),
        m.profit === null ? cell(null) : cell(m.profit),
      ],
    },
  ];
  return (
    <section className="rounded-[14px] border border-[#dbe3f7] bg-white">
      <h2 className="border-b border-[#d8deee] px-4 py-3 text-[14px] font-bold text-[#1b2333]">
        Estado de resultados
      </h2>
      <div className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-xs text-[#6b7385]">
              <th
                scope="col"
                className="px-3 py-2 text-left font-semibold sm:px-4"
              >
                {m.isCurrentMonth ? "" : monthLabelEs(m.month)}
              </th>
              <th
                scope="col"
                className="w-[28%] px-2 py-2 text-right font-semibold sm:w-[22%]"
              >
                {twoCols ? "Hasta ayer" : "Mes"}
              </th>
              {twoCols ? (
                <th
                  scope="col"
                  className="w-[28%] px-2 py-2 text-right font-semibold sm:w-[22%]"
                >
                  Proyección
                </th>
              ) : null}
              <th
                scope="col"
                className="w-[16%] px-2 py-2 text-right font-semibold sm:w-[12%]"
              >
                <span className="sr-only">Ver</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className={
                  "border-t border-[#eef1f8] " +
                  (r.strong ? "bg-[#E7EDFD] font-bold" : "")
                }
              >
                <th
                  scope="row"
                  className="break-words px-3 py-2 text-left font-medium text-[#0f1b3d] sm:px-4"
                >
                  {r.label}
                </th>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.soon ? (
                    <span className="text-xs font-semibold text-[#6b7385]">
                      {r.values[0]}
                    </span>
                  ) : (
                    r.values[0]
                  )}
                </td>
                {twoCols ? (
                  <td className="px-2 py-2 text-right tabular-nums">
                    {r.soon ? (
                      <span className="text-xs font-semibold text-[#6b7385]">
                        {r.values[1]}
                      </span>
                    ) : (
                      r.values[1]
                    )}
                  </td>
                ) : null}
                <td className="px-2 py-2 text-right">
                  {r.href ? (
                    <Link
                      href={r.href}
                      className="text-sm font-semibold text-[#1B40C8] underline"
                    >
                      Ver →
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-[#d8deee] px-4 py-3 text-xs text-[#6b7385]">
        <p>
          Los costos fijos son los del mes completo
          {twoCols ? " en las dos columnas" : ""}.
        </p>
        {m.coverage.uncovered.length === 0 && m.coverage.pct > 0 ? (
          <p>
            <span className="rounded-full bg-[#E7EDFD] px-2 py-0.5 font-semibold text-[#1B40C8]">
              platos con receta: 100% de tus ventas
            </span>
          </p>
        ) : null}
        {m.coverage.coveredMarginPct !== null ? (
          <p>
            Tus platos con receta dejan{" "}
            <strong className="text-[#0f1b3d]">
              {pctText(m.coverage.coveredMarginPct)}
            </strong>{" "}
            de margen.
          </p>
        ) : null}
        {m.isCurrentMonth ? (
          <p>
            La proyección sigue el promedio de cada día de la semana de las
            últimas 4 semanas.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function estimadaLabel(basis: "real" | "estimada", word: string): string {
  return basis === "estimada" ? `${word} estimada` : word;
}

function DailyTable({
  data,
  money,
}: {
  data: RentabilidadPageData;
  money: (n: number) => string;
}) {
  const m = data.month;
  return (
    <section className="rounded-[14px] border border-[#dbe3f7] bg-white">
      <h2 className="border-b border-[#d8deee] px-4 py-3 text-[14px] font-bold text-[#1b2333]">
        Por día
      </h2>
      <div className="overflow-hidden">
        <table className="w-full table-fixed text-xs sm:text-sm">
          <thead>
            <tr className="text-[#6b7385]">
              <th
                scope="col"
                className="px-2 py-2 text-left font-semibold sm:px-4"
              >
                Día
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Ventas
              </th>
              <th
                scope="col"
                className="hidden px-2 py-2 text-right font-semibold sm:table-cell"
              >
                Comida
              </th>
              <th
                scope="col"
                className="hidden px-2 py-2 text-right font-semibold sm:table-cell"
              >
                Impuestos
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Margen
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Acumulado
              </th>
            </tr>
          </thead>
          <tbody>
            {m.days.map((d) => (
              <tr
                key={d.date}
                className={
                  "border-t border-[#eef1f8] " +
                  (d.projected ? "text-[#6b7385] italic" : "")
                }
              >
                <th
                  scope="row"
                  className="px-2 py-1.5 text-left font-medium sm:px-4"
                >
                  {capitalize(weekdayEs(d.weekday).slice(0, 3))}{" "}
                  {Number(d.date.slice(8, 10))}
                  {d.projected ? " · proy." : ""}
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {money(d.sales)}
                </td>
                <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">
                  {money(d.food)}
                </td>
                <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">
                  {money(d.impuestos)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {money(d.margin)}
                </td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  {money(d.cumMargin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[#d8deee] px-4 py-3 text-xs text-[#6b7385]">
        La comida y bebida de cada día se reparte según sus ventas: el total del
        mes es el costo real de tus platos con receta.
      </p>
    </section>
  );
}
