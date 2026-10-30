// Small, pure formatting helpers (Spanish). Never formats money: the kitchen
// app has none.

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

const two = (n: number) => String(n).padStart(2, "0");

/** 75000 -> "1:15" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${two(total % 60)}`;
}

/** "Hoy 14:30", "Ayer 09:05" or "29 oct 14:30" (device time). */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const day = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000);
  if (diffDays === 0) return `Hoy ${time}`;
  if (diffDays === 1) return `Ayer ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** 0.5 -> "0.5", 12 -> "12", 1.2500 -> "1.25" */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

/** "14:30" (device time). */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export type DayGroup = "today" | "yesterday" | "earlier";

/** Today, yesterday or earlier, by the device's calendar day. */
export function dayGroup(iso: string, now: Date = new Date()): DayGroup {
  const d = new Date(iso);
  const day = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  return diff <= 0 ? "today" : diff === 1 ? "yesterday" : "earlier";
}

/** "Carlos Mejía" -> "CM", "luis" -> "L", "" -> "?" */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}
