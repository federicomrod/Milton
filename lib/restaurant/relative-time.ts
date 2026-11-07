// lib/restaurant/relative-time.ts
//
// «hace 5 min», «hace 3 h», «ayer», in the person's language. Pure (the clock
// is passed in) so it is unit-testable. Older than a week → the date.

export function relativeTimeText(
  iso: string,
  nowMs: number,
  locale: string
): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const mins = Math.round((t - nowMs) / 60000);
  if (Math.abs(mins) < 1) return rtf.format(0, "minute");
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return rtf.format(days, "day");
  return new Date(t).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

/**
 * What a history row says about the value: the change for an amount («+$650»),
 * the amount itself when it did not move or is new from nothing, the rate for a
 * tax. The caller formats money.
 */
export function historyDelta(
  old: number | null,
  next: number | null
): { kind: "delta"; sign: "+" | "-"; abs: number } | { kind: "value" } {
  if (old === null || next === null || old === next) return { kind: "value" };
  const diff = Math.round((next - old) * 100) / 100;
  return { kind: "delta", sign: diff > 0 ? "+" : "-", abs: Math.abs(diff) };
}
