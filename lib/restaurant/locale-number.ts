// lib/restaurant/locale-number.ts
//
// Typed amounts and quantities, read by the active language's number format:
//   de       «.» thousands, «,» decimal   1.234,50  1234,5
//   es / en  «,» thousands, «.» decimal   1,234.50  1234.5
// Never guesses: text that does not fit the language's format is rejected, so
// a number is never saved silently different from what was typed (German
// «1234,5» is 1234.5; «1,234.50» is an error in German, not 123450).
// Pure, no React. Empty text is "no value", not zero.

import type { PreferredLanguage } from "@/lib/restaurant/language";

export type TypedNumber =
  | { ok: true; value: number | null }
  | { ok: false; reason: "invalid" | "negative" };

function separators(lang: PreferredLanguage) {
  return lang === "de"
    ? { group: ".", decimal: "," }
    : { group: ",", decimal: "." };
}

const escape = (c: string) => `\\${c}`;

/** Spaces, NBSP, thin spaces, a currency sign or ISO code before or after, and a trailing % are ignored. */
function strip(text: string): string {
  return text
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/%$/, "")
    .replace(/^(?:[$€£¥]|[A-Z]{3})/, "")
    .replace(/(?:[$€£¥]|[A-Z]{3})$/, "");
}

export function parseLocaleNumber(
  text: string,
  lang: PreferredLanguage
): TypedNumber {
  const raw = String(text ?? "").replace(/[\s\u00a0\u202f]/g, "");
  if (raw === "") return { ok: true, value: null };
  const clean = strip(raw);
  if (clean === "") return { ok: false, reason: "invalid" };
  if (clean.startsWith("-")) return { ok: false, reason: "negative" };
  const { group, decimal } = separators(lang);
  const g = escape(group);
  const d = escape(decimal);
  const grouped = new RegExp(`^\\d{1,3}(?:${g}\\d{3})+(?:${d}\\d+)?$`);
  const plain = new RegExp(`^\\d+(?:${d}\\d+)?$`);
  if (!grouped.test(clean) && !plain.test(clean)) {
    return { ok: false, reason: "invalid" };
  }
  const normalized = clean.split(group).join("").replace(decimal, ".");
  const n = Number(normalized);
  return Number.isFinite(n)
    ? { ok: true, value: n }
    : { ok: false, reason: "invalid" };
}

/** The number typed, or null when empty or not valid. Use where a form only needs "usable or not". */
export function typedNumber(
  text: string,
  lang: PreferredLanguage
): number | null {
  const r = parseLocaleNumber(text, lang);
  return r.ok ? r.value : null;
}

/** A number as editable text in the language's format (no thousands separator). */
export function formatTypedNumber(
  value: number,
  lang: PreferredLanguage
): string {
  const text = String(value);
  const plain = /e/i.test(text) ? value.toFixed(6).replace(/\.?0+$/, "") : text;
  return lang === "de" ? plain.replace(".", ",") : plain;
}

/**
 * `Number(text)` for a typed field, by language. German reads «1,5» and
 * «1.234,5»; other languages keep the plain `Number` reading. Empty is 0 and
 * invalid text is NaN, exactly like `Number`, so existing `> 0` / finite
 * checks keep working.
 */
export function inputNumber(text: string, lang: PreferredLanguage): number {
  if (lang !== "de") return Number(text);
  const r = parseLocaleNumber(text, "de");
  return r.ok ? (r.value ?? 0) : Number.NaN;
}
