// lib/restaurant/onboarding-copy.ts
//
// Onboarding option lists, validation and lookup tables in one place. The
// words themselves live in the dictionaries (lib/i18n/{es,en,de}/onboarding.ts);
// the exports here carry the SPANISH labels (the default language), and the
// *Label(lang) helpers / getNextStepCards(pos, lang) give any other language.
//
// Nothing in this file does I/O — pure constants and types, safe to import
// from both server and client components.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConceptType =
  | "restaurant"
  | "bar"
  | "cafe"
  | "bakery"
  | "fast_casual"
  | "other";

export type LocationCountBucket = "1" | "2-3" | "4-10" | "10+";

export type PosSystemChoice =
  | "odoo"
  | "revel"
  | "square"
  | "toast"
  | "other"
  | "unknown";

export type PriorityKey =
  | "margins"
  | "food_cost"
  | "sales"
  | "inventory"
  | "waste"
  | "forecast";

export const MAX_PRIORITIES = 3;

const es = getDictionary("es").onboarding;

/** Dictionary key of each option value. */
const CONCEPT_KEY: Record<ConceptType, keyof typeof es.concept> = {
  restaurant: "restaurant",
  bar: "bar",
  cafe: "cafe",
  bakery: "bakery",
  fast_casual: "fastCasual",
  other: "other",
};
const PRIORITY_KEY: Record<PriorityKey, keyof typeof es.priority> = {
  margins: "margins",
  food_cost: "foodCost",
  sales: "sales",
  inventory: "inventory",
  waste: "waste",
  forecast: "forecast",
};

export function conceptTypeLabel(
  value: ConceptType,
  lang: PreferredLanguage
): string {
  return getDictionary(lang).onboarding.concept[CONCEPT_KEY[value]];
}

export function priorityLabel(
  value: PriorityKey,
  lang: PreferredLanguage
): string {
  return getDictionary(lang).onboarding.priority[PRIORITY_KEY[value]];
}

export function posSystemLabel(
  value: PosSystemChoice,
  lang: PreferredLanguage
): string {
  const pos = getDictionary(lang).onboarding.pos;
  if (value === "other") return pos.other;
  if (value === "unknown") return pos.unknown;
  return POS_SYSTEM_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function countryLabel(code: string, lang: PreferredLanguage): string {
  const names = getDictionary(lang).onboarding.country as Record<
    string,
    string
  >;
  return names[code] ?? code;
}

// ---------------------------------------------------------------------------
// Step copy
// ---------------------------------------------------------------------------

export const ONBOARDING_COPY = {
  step1: es.step1,
  step2: es.step2,
  step3: {
    title: es.step3.title,
    subtitle: fmt(es.step3.subtitle, { max: MAX_PRIORITIES }),
  },
  step4: es.step4,
  nav: es.nav,
} as const;

// ---------------------------------------------------------------------------
// Option lists — each option carries the label shown to the user. Icons are
// wired up in the component layer (icon components aren't serializable
// copy, so they don't belong in this file).
// ---------------------------------------------------------------------------

export const CONCEPT_TYPE_OPTIONS: { value: ConceptType; label: string }[] = [
  { value: "restaurant", label: es.concept.restaurant },
  { value: "bar", label: es.concept.bar },
  { value: "cafe", label: es.concept.cafe },
  { value: "bakery", label: es.concept.bakery },
  { value: "fast_casual", label: es.concept.fastCasual },
  { value: "other", label: es.concept.other },
];

export const LOCATION_COUNT_OPTIONS: {
  value: LocationCountBucket;
  label: string;
}[] = [
  { value: "1", label: "1" },
  { value: "2-3", label: "2–3" },
  { value: "4-10", label: "4–10" },
  { value: "10+", label: "10+" },
];

export const POS_SYSTEM_OPTIONS: { value: PosSystemChoice; label: string }[] = [
  { value: "odoo", label: "Odoo" },
  { value: "revel", label: "Revel" },
  { value: "square", label: "Square" },
  { value: "toast", label: "Toast" },
  { value: "other", label: es.pos.other },
  { value: "unknown", label: es.pos.unknown },
];

export const PRIORITY_OPTIONS: { value: PriorityKey; label: string }[] = [
  { value: "margins", label: es.priority.margins },
  { value: "food_cost", label: es.priority.foodCost },
  { value: "sales", label: es.priority.sales },
  { value: "inventory", label: es.priority.inventory },
  { value: "waste", label: es.priority.waste },
  { value: "forecast", label: es.priority.forecast },
];

// ---------------------------------------------------------------------------
// Countries — a practical, non-exhaustive list for a fast selectable
// dropdown (not free text). Includes an ISO currency so the first
// restaurant_location can get a sensible currency without asking a
// separate question. Mexico is listed first since Milton's first real
// pilot is there; the rest are alphabetical.
// ---------------------------------------------------------------------------

export interface CountryOption {
  code: string; // ISO 3166-1 alpha-2
  label: string;
  currency: string; // ISO 4217
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "MX", label: es.country.MX, currency: "MXN" },
  { code: "US", label: es.country.US, currency: "USD" },
  { code: "CA", label: es.country.CA, currency: "CAD" },
  { code: "AR", label: es.country.AR, currency: "ARS" },
  { code: "BR", label: es.country.BR, currency: "BRL" },
  { code: "CL", label: es.country.CL, currency: "CLP" },
  { code: "CO", label: es.country.CO, currency: "COP" },
  { code: "SV", label: es.country.SV, currency: "USD" },
  { code: "GT", label: es.country.GT, currency: "GTQ" },
  { code: "ES", label: es.country.ES, currency: "EUR" },
  { code: "DE", label: es.country.DE, currency: "EUR" },
  { code: "IT", label: es.country.IT, currency: "EUR" },
  { code: "CH", label: es.country.CH, currency: "CHF" },
  { code: "PE", label: es.country.PE, currency: "PEN" },
  { code: "GB", label: es.country.GB, currency: "GBP" },
  { code: "PT", label: es.country.PT, currency: "EUR" },
  { code: "OTHER", label: es.country.OTHER, currency: "USD" },
];

export function currencyForCountry(countryCode: string): string {
  return COUNTRY_OPTIONS.find((c) => c.code === countryCode)?.currency ?? "USD";
}

// ---------------------------------------------------------------------------
// Server-side validation — the option lists above are the source of truth
// for what's allowed. These are the only guard against a malformed/invalid
// payload now that the persisted columns carry no DB-level CHECK
// constraint (deliberately additive-only migration). Each normalizer
// accepts `unknown` (raw JSON body input) and returns either a known-good
// value or, for the scalar fields, null — never throws, never trusts the
// input's shape.
// ---------------------------------------------------------------------------

export function normalizeConceptType(value: unknown): ConceptType | null {
  return CONCEPT_TYPE_OPTIONS.some((o) => o.value === value)
    ? (value as ConceptType)
    : null;
}

export function normalizeLocationCountBucket(
  value: unknown
): LocationCountBucket | null {
  return LOCATION_COUNT_OPTIONS.some((o) => o.value === value)
    ? (value as LocationCountBucket)
    : null;
}

export function normalizePosSystemChoice(
  value: unknown
): PosSystemChoice | null {
  return POS_SYSTEM_OPTIONS.some((o) => o.value === value)
    ? (value as PosSystemChoice)
    : null;
}

/**
 * Filters `value` down to known priority keys, drops duplicates, and caps
 * the result at MAX_PRIORITIES — taking the first MAX_PRIORITIES valid,
 * distinct entries in submission order. A non-array input (missing,
 * malformed, wrong type) normalizes to an empty array rather than an
 * error, matching "priorities are optional" in the wizard itself.
 */
export function normalizePriorities(value: unknown): PriorityKey[] {
  if (!Array.isArray(value)) return [];
  const validKeys = new Set<string>(PRIORITY_OPTIONS.map((o) => o.value));
  const result: PriorityKey[] = [];
  const seen = new Set<PriorityKey>();
  for (const entry of value) {
    if (result.length >= MAX_PRIORITIES) break;
    if (
      typeof entry === "string" &&
      validKeys.has(entry) &&
      !seen.has(entry as PriorityKey)
    ) {
      seen.add(entry as PriorityKey);
      result.push(entry as PriorityKey);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 4 — recommended first action, personalized by POS choice.
// ---------------------------------------------------------------------------

export interface NextStepCard {
  key: "connect_pos" | "upload_sales" | "add_recipes";
  title: string;
  description: string;
  href: string;
  cta: string;
}

/**
 * Odoo has no self-serve connection UI yet (deliberately out of scope for
 * this task — see PR notes), so "Connect my POS" points at the same real,
 * working upload page as everyone else, with honest copy instead of a
 * dead link. Every other POS choice leads there directly since that page
 * is today's actual working ingestion path.
 */
export function getNextStepCards(
  posSystem: PosSystemChoice,
  lang: PreferredLanguage = "es"
): NextStepCard[] {
  const d = getDictionary(lang).onboarding.nextSteps;
  const connectPos: NextStepCard =
    posSystem === "odoo"
      ? {
          key: "connect_pos",
          title: d.connectPosTitle,
          description: d.connectPosOdooDescription,
          href: "/dashboard/restaurant/upload",
          cta: d.connectPosOdooCta,
        }
      : {
          key: "connect_pos",
          title: d.connectPosTitle,
          description: d.connectPosDescription,
          href: "/dashboard/restaurant/upload",
          cta: d.connectPosCta,
        };

  const uploadSales: NextStepCard = {
    key: "upload_sales",
    title: d.uploadSalesTitle,
    description: d.uploadSalesDescription,
    href: "/dashboard/restaurant/upload",
    cta: d.uploadSalesCta,
  };

  const addRecipes: NextStepCard = {
    key: "add_recipes",
    title: d.addRecipesTitle,
    description: d.addRecipesDescription,
    href: "/dashboard/restaurant/menu",
    cta: d.addRecipesCta,
  };

  // Lead with the connection step when the POS is unknown/unclear; lead
  // with the upload step when a known, already-supported POS was picked.
  if (
    posSystem === "unknown" ||
    posSystem === "other" ||
    posSystem === "odoo"
  ) {
    return [connectPos, addRecipes, uploadSales];
  }
  return [uploadSales, addRecipes, connectPos];
}
