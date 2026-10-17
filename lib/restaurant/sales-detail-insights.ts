// lib/restaurant/sales-detail-insights.ts
//
// What the Ventas page says about the period on screen, deterministic and pure
// (no AI call, no I/O): «Lo que destaca» (max 3 facts), «Análisis de ventas y
// tickets» (one paragraph) and the leader of each dimension. Everything is
// computed from the cube's view (computeDetail), so it follows the filters.

import type { DetailView, DimRow } from "@/lib/restaurant/sales-detail";

export interface SalesFormat {
  money: (n: number) => string;
  /** "jue 30 jul" from "2026-07-30". */
  day: (ymd: string) => string;
  /** "7 pm" from 19. */
  hour: (h: number) => string;
}

export interface SalesFact {
  id: "mejor_dia" | "hora_fuerte" | "turno" | "franja";
  title: string;
  body: string;
}

const WEEKDAYS = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];

/** Where the day is split when there are no shifts: before / from 5 pm (the 17:00 lunch / dinner default). */
export const DAY_SPLIT_HOUR = 17;

const pct = (n: number) => `${Math.round(n)}%`;

/** Up to 3 facts: the best day, the peak hour slot, and the top shift (or lunch / dinner). */
export function salesFacts(view: DetailView, fmt: SalesFormat): SalesFact[] {
  if (view.empty || !view.kpis.net.value || view.kpis.net.value <= 0) return [];
  const facts: SalesFact[] = [];

  const best = view.kpis.best;
  if (best && best.net > 0) {
    facts.push({
      id: "mejor_dia",
      title: "Mejor día",
      body: `${fmt.day(best.date)} · ${fmt.money(best.net)}${
        best.tickets > 0 ? ` en ${best.tickets} tickets` : ""
      }`,
    });
  }

  // The peak slot: the weekday × hour cell with the most sales.
  let peak: { wd: number; h: number; net: number } | null = null;
  let am = 0;
  let pm = 0;
  for (let wd = 1; wd <= 7; wd += 1) {
    const row = view.heat[wd];
    if (!row) continue;
    for (let h = 0; h < 24; h += 1) {
      const net = row[h]?.net ?? 0;
      if (net <= 0) continue;
      if (h < DAY_SPLIT_HOUR) am += net;
      else pm += net;
      if (!peak || net > peak.net) peak = { wd, h, net };
    }
  }
  if (peak) {
    facts.push({
      id: "hora_fuerte",
      title: "Hora fuerte",
      body: `${WEEKDAYS[peak.wd - 1]} a las ${fmt.hour(peak.h)} · ${fmt.money(peak.net)}`,
    });
  }

  const shift = view.shiftCards
    ?.filter((c) => !c.other && c.net > 0)
    .sort((a, b) => b.net - a.net)[0];
  if (shift) {
    facts.push({
      id: "turno",
      title: "Turno principal",
      body: `${shift.name} · ${pct(shift.share)} de las ventas (${fmt.money(shift.net)})`,
    });
  } else if (am + pm > 0) {
    const total = am + pm;
    facts.push({
      id: "franja",
      title: "Almuerzo y cena",
      body: `Antes de las ${fmt.hour(DAY_SPLIT_HOUR)}: ${pct((am / total) * 100)} · desde las ${fmt.hour(DAY_SPLIT_HOUR)}: ${pct((pm / total) * 100)}`,
    });
  }
  return facts.slice(0, 3);
}

/** «Análisis de ventas y tickets»: one paragraph, deterministic. */
export function salesRead(view: DetailView, fmt: SalesFormat): string | null {
  const net = view.kpis.net.value;
  if (view.empty || net === null || net <= 0) return null;
  const parts: string[] = [];
  const tickets = view.kpis.tickets.value;
  const ticket = view.kpis.ticket.value;
  parts.push(
    `En ${view.days} ${view.days === 1 ? "día" : "días"} vendiste ${fmt.money(net)}` +
      (tickets ? ` en ${Math.round(tickets)} tickets` : "") +
      (ticket ? `, con un ticket promedio de ${fmt.money(ticket)}` : "") +
      "."
  );
  const d = view.kpis.net.delta;
  if (d !== null && view.compare.baseline) {
    parts.push(
      Math.abs(d) < 1
        ? `Es prácticamente lo mismo que ${view.compare.label}.`
        : `Es ${d > 0 ? "" : "−"}${Math.abs(Math.round(d))}% ${d > 0 ? "más" : "menos"} que ${view.compare.label}.`
    );
  }
  const tk = view.kpis.tickets.delta;
  if (tk !== null && d !== null && Math.abs(tk) >= 1 && view.compare.baseline) {
    parts.push(
      tk > 0
        ? "Los tickets subieron: el movimiento viene de más clientes."
        : "Los tickets bajaron: vienen menos clientes."
    );
  }
  const facts = salesFacts(view, fmt);
  const bestDay = facts.find((f) => f.id === "mejor_dia");
  const peak = facts.find((f) => f.id === "hora_fuerte");
  if (bestDay) parts.push(`Mejor día: ${bestDay.body.split(" · ")[0]}.`);
  if (peak) parts.push(`La hora más fuerte fue ${peak.body.split(" · ")[0]}.`);
  return parts.join(" ");
}

export interface DimensionLeader {
  label: string;
  share: number;
}

/** «En salón · 94.2%»: the row with the most sales. Nothing sold = no leader. */
export function dimensionLeader(
  rows: readonly Pick<DimRow, "label" | "net" | "share">[]
): DimensionLeader | null {
  let best: Pick<DimRow, "label" | "net" | "share"> | null = null;
  for (const row of rows)
    if (row.net > 0 && (!best || row.net > best.net)) best = row;
  return best ? { label: best.label, share: best.share } : null;
}

export function leaderLabel(leader: DimensionLeader): string {
  return `${leader.label} · ${leader.share.toFixed(1)}%`;
}
