// components/restaurant/rentabilidad/RentabilidadPage.tsx
//
// Rentabilidad (#400): is the restaurant making money this month? Hero
// sentence, the two numbers (Ganancia real hasta ayer · Proyección al cierre),
// the coverage flag, the race chart, the KPIs, «¿A dónde va cada $100?», the
// ✦ Milton card, the Estado de resultados and the daily table. Every number
// comes from rentabilidad.ts; this file only lays it out. Spanish only.
//
// Colors: brand blue #1B40C8 (hover #1533A3, tint #E7EDFD) for what matters,
// red #b42318 for ⚑ flags and losses, lavender #D8D0F8 ONLY for a Milton
// estimate. Changing the month keeps the previous view on screen (no spinner).

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

const BLUE = "#1B40C8";
const RED = "#b42318";
const GREEN = "#12804A";
const BTN =
  "inline-flex items-center justify-center rounded-md bg-[#1B40C8] px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1533A3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2";
const BTN_OUTLINE =
  "inline-flex items-center justify-center rounded-md border border-[#1B40C8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1B40C8] hover:bg-[#E7EDFD]";

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
  merma: "#7C93E6",
  impuestos: "#B6C4F2",
  planilla: "#0E7C66",
  alquiler: "#2F9E8A",
  servicios: "#7CC9B7",
  otros: "#B9A84A",
  ganancia: GREEN,
};

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

  return (
    <div
      className={
        "w-full space-y-4 px-4 py-3 sm:px-6 lg:px-10 " +
        (pending ? "opacity-70 transition-opacity" : "transition-opacity")
      }
      aria-busy={pending}
    >
      {/* Header + month picker */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#0f1b3d]">
            Rentabilidad
          </h1>
          <p className="text-sm text-[#6b7385]">
            {locationName ? `${locationName} · ` : ""}
            {m.isCurrentMonth
              ? `Datos hasta ayer (${dayLabelEs(addDay(data.today, -1))})`
              : monthLabelEs(m.month)}
          </p>
        </div>
        <nav aria-label="Mes" className="flex flex-wrap items-center gap-2">
          {months.map((month) => {
            const active = month === m.month;
            return (
              <button
                key={month}
                type="button"
                onClick={() => goto(month)}
                aria-pressed={active}
                className={
                  "rounded-md border px-3 py-1.5 text-sm font-semibold " +
                  (active
                    ? "border-[#1B40C8] bg-[#1B40C8] text-white"
                    : "border-[#1B40C8] bg-white text-[#1B40C8] hover:bg-[#E7EDFD]")
                }
              >
                {month === currentMonth
                  ? `${capitalize(monthNameEs(month))} (este mes)`
                  : capitalize(monthNameEs(month))}
              </button>
            );
          })}
          <label className={BTN_OUTLINE + " cursor-pointer"}>
            <span>Elegir mes</span>
            <input
              type="month"
              max={currentMonth.slice(0, 7)}
              value={m.month.slice(0, 7)}
              onChange={(e) =>
                e.target.value ? goto(`${e.target.value}-01`) : undefined
              }
              className="ml-2 w-[8.5rem] border-0 bg-transparent p-0 text-sm text-[#1B40C8] focus:outline-none"
              aria-label="Elegir mes"
            />
          </label>
        </nav>
      </header>

      {!m.hasData ? (
        <section className="rounded-lg border border-[#d8deee] bg-white p-5 text-[15px] text-[#0f1b3d]">
          {heroSentence(m, money)}
        </section>
      ) : (
        <>
          {/* Hero sentence */}
          <p className="text-[17px] font-semibold leading-snug text-[#0f1b3d] sm:text-lg">
            {heroSentence(m, money)}
          </p>

          {/* Missing fixed costs (mock 5) */}
          {fixedMissing ? (
            <section
              aria-label="Costos fijos faltantes"
              className="rounded-lg border-2 border-[#b42318] bg-[#fff5f4] p-4"
            >
              <p className="text-[15px] font-bold" style={{ color: RED }}>
                ⚑ Faltan costos fijos: sin ellos no se puede calcular tu
                ganancia ni tu punto de equilibrio.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {m.fixed.missing.map((cat) => (
                  <li
                    key={cat}
                    className="rounded-md bg-white px-2.5 py-1 text-sm font-semibold"
                    style={{ color: RED, border: `1px solid ${RED}` }}
                  >
                    ⚑ Falta {CATEGORY_LABELS_ES[cat]}
                  </li>
                ))}
              </ul>
              <Link href={fixedHref} className={BTN + " mt-3"}>
                Sube tus costos fijos
              </Link>
            </section>
          ) : null}

          {/* Coverage flag: always above the profit when coverage < 100% */}
          {showFlag ? (
            <CoverageFlag
              uncoveredPct={m.coverage.uncoveredPct}
              uncovered={m.coverage.uncovered}
              moreHref={platos}
              locationId={locationId}
            />
          ) : null}

          {/* The two numbers */}
          {!fixedMissing && m.profit !== null ? (
            <section
              aria-label="Ganancia"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {m.isCurrentMonth && m.profitToDate !== null ? (
                <NumberCard
                  label={
                    estimada
                      ? "Ganancia estimada hasta ayer"
                      : "Ganancia real hasta ayer"
                  }
                  value={signed(m.profitToDate, money)}
                  color={m.profitToDate >= 0 ? GREEN : RED}
                  estimate={estimada}
                  note="Margen acumulado menos los costos fijos de todo el mes"
                />
              ) : null}
              <NumberCard
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
                color={m.isCurrentMonth ? BLUE : m.profit >= 0 ? GREEN : RED}
                estimate={estimada}
                note={
                  m.profitPct === null
                    ? undefined
                    : `${pctText(m.profitPct)} de tus ventas${
                        m.isCurrentMonth ? " · proyección" : ""
                      }`
                }
              />
            </section>
          ) : null}

          {/* Comparison chips (real numbers only) */}
          {chips.length > 0 ? (
            <ul
              className="flex flex-wrap gap-2"
              aria-label="Contra el mes pasado"
            >
              {chips.map((c) => (
                <li
                  key={c.text}
                  className="rounded-full px-3 py-1 text-sm font-semibold"
                  style={{
                    background:
                      c.tone === "good"
                        ? "#E5F5EC"
                        : c.tone === "bad"
                          ? "#FDE8E6"
                          : "#E7EDFD",
                    color:
                      c.tone === "good" ? GREEN : c.tone === "bad" ? RED : BLUE,
                  }}
                >
                  {c.text}
                </li>
              ))}
            </ul>
          ) : null}

          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Vista"
            className="flex gap-1 border-b border-[#d8deee]"
          >
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
                className={
                  "-mb-px border-b-2 px-4 py-2 text-sm font-semibold " +
                  (tab === id
                    ? "border-[#1B40C8] text-[#1B40C8]"
                    : "border-transparent text-[#0f1b3d] hover:text-[#1B40C8]")
                }
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "resumen" ? (
            <div className="space-y-4">
              {/* Race chart */}
              {!fixedMissing ? (
                <section className="rounded-lg border border-[#d8deee] bg-white p-3 sm:p-4">
                  <h2 className="mb-2 text-sm font-bold text-[#0f1b3d]">
                    ¿Ya cubriste tus costos fijos?
                  </h2>
                  <RaceChart month={m} money={money} />
                </section>
              ) : null}

              {/* KPIs */}
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
                  value={
                    m.fixed.amounts.planilla !== null
                      ? pctText(
                          m.fixed.amounts.planilla /
                            Math.max(m.monthTotals.sales, 1)
                        )
                      : "—"
                  }
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

              {/* Cada $100 + Milton card */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <section className="rounded-lg border border-[#d8deee] bg-white p-4 lg:col-span-2">
                  <h2 className="mb-3 text-sm font-bold text-[#0f1b3d]">
                    ¿A dónde va cada $100 que vendes?
                  </h2>
                  {m.cada100 ? (
                    <Cada100Bar parts={m.cada100} loss={m.cada100Loss} />
                  ) : (
                    <p className="text-sm" style={{ color: RED }}>
                      ⚑ Falta cargar tus costos fijos para repartir tus ventas.
                    </p>
                  )}
                </section>
                <section
                  className="rounded-lg p-4"
                  style={{ background: "#E7EDFD" }}
                  aria-label="Milton"
                >
                  <h2
                    className="mb-1 text-sm font-bold"
                    style={{ color: BLUE }}
                  >
                    ✦ Milton
                  </h2>
                  {findings.length > 0 ? (
                    findings.map((f) => (
                      <p
                        key={f}
                        className="text-sm leading-snug text-[#0f1b3d]"
                      >
                        {f}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm leading-snug text-[#0f1b3d]">
                      {m.breakEvenPerDay === null
                        ? "Cuando cargues tus costos fijos te digo qué días te cuestan más."
                        : "Todos tus días venden por encima de lo que necesitas."}
                    </p>
                  )}
                </section>
              </div>

              {/* Estado de resultados */}
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

function NumberCard({
  label,
  value,
  color,
  note,
  estimate,
}: {
  label: string;
  value: string;
  color: string;
  note?: string;
  estimate: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#d8deee] bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[#0f1b3d]">{label}</p>
        {estimate ? (
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-bold text-[#0f1b3d]"
            style={{ background: "#D8D0F8" }}
          >
            Estimado por Milton
          </span>
        ) : null}
      </div>
      <p
        className="mt-1 text-[34px] font-extrabold leading-tight tracking-tight tabular-nums"
        style={{ color }}
      >
        {value}
      </p>
      {note ? <p className="mt-0.5 text-xs text-[#6b7385]">{note}</p> : null}
    </div>
  );
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
    <div className="rounded-lg border border-[#d8deee] bg-white p-3">
      <p className="text-xs font-semibold text-[#6b7385]">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums text-[#0f1b3d]">
        {value}
      </p>
      {sub ? (
        <p
          className={"text-xs " + (flag ? "font-semibold" : "text-[#6b7385]")}
          style={flag ? { color: RED } : undefined}
        >
          {sub}
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
      className="rounded-lg border-2 bg-[#fff5f4] p-4"
      style={{ borderColor: RED }}
    >
      <p className="text-base font-bold leading-snug" style={{ color: RED }}>
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
        className="flex h-8 w-full overflow-hidden rounded-md"
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
        <p className="mt-2 text-sm font-semibold" style={{ color: RED }}>
          Tus costos pasan de $100: este mes hay pérdida.
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
      <span style={{ color: RED }}>⚑ Falta</span>
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
    <section className="rounded-lg border border-[#d8deee] bg-white">
      <h2 className="border-b border-[#d8deee] px-4 py-3 text-sm font-bold text-[#0f1b3d]">
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
    <section className="rounded-lg border border-[#d8deee] bg-white">
      <h2 className="border-b border-[#d8deee] px-4 py-3 text-sm font-bold text-[#0f1b3d]">
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
