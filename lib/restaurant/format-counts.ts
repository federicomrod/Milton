// lib/restaurant/format-counts.ts
//
// Shared quantity / count formatters for the Revenue & Channels tab.
// Never render a raw float in a chip or breakdown card — always locale
// format and cap fractional digits.

function rounded2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Locale-format a count, at most two decimal places. */
export function formatCount(n: number, locale = "en-US"): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = rounded2(n);
  return rounded.toLocaleString(locale, {
    maximumFractionDigits: 2,
  });
}

/** Chip badge: "1 item" / "1,234 items" / "12.5 items". */
export function formatChipQuantity(n: number, locale = "en-US"): string {
  const rounded = Number.isFinite(n) ? rounded2(n) : 0;
  const noun = rounded === 1 ? "item" : "items";
  return `${formatCount(rounded, locale)} ${noun}`;
}
