// R1-17b: small shared helpers of the Ventas › Detalle page (Spanish, tú).

import { formatMoneyEs } from "@/lib/restaurant/recipe-costing/format";

export const WEEKDAYS_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]; // ISO 1..7
export const WEEKDAYS_LONG = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
];
const MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

export const BLUE = "#1b40c8";

export function moneyFmt(currency: string) {
  return (n: number, decimals = 0) => formatMoneyEs(n, currency, { decimals });
}

/** "jue 30 jul" */
export function dayLabelEs(ymd: string): string {
  const d = new Date(
    Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
  );
  return `${WEEKDAYS_SHORT[(d.getUTCDay() + 6) % 7].toLowerCase()} ${+ymd.slice(8)} ${MONTHS[+ymd.slice(5, 7) - 1]}`;
}

/** "25–31 jul 2026" / "28 jun – 4 jul 2026" */
export function rangeLabelEs(from: string, to: string): string {
  const f = { d: +from.slice(8), m: +from.slice(5, 7), y: from.slice(0, 4) };
  const t = { d: +to.slice(8), m: +to.slice(5, 7), y: to.slice(0, 4) };
  if (from === to) return `${t.d} ${MONTHS[t.m - 1]} ${t.y}`;
  if (f.m === t.m && f.y === t.y)
    return `${f.d}–${t.d} ${MONTHS[t.m - 1]} ${t.y}`;
  return `${f.d} ${MONTHS[f.m - 1]}${f.y === t.y ? "" : ` ${f.y}`} – ${t.d} ${MONTHS[t.m - 1]} ${t.y}`;
}

/** "+18%" / "−42%" / "—" (no comparable period: never 0%). */
export function pctLabel(delta: number | null, digits = 0): string {
  if (delta === null) return "—";
  const v =
    digits === 0
      ? Math.round(delta)
      : Math.round(delta * 10 ** digits) / 10 ** digits;
  if (v === 0) return "0%";
  const body = Math.abs(v).toLocaleString("es-MX", {
    maximumFractionDigits: digits,
  });
  return `${v > 0 ? "+" : "−"}${body}%`;
}

export function hourLabel(h: number): string {
  return `${h}h`;
}
