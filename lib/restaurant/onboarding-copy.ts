// lib/restaurant/onboarding-copy.ts
//
// All restaurant onboarding copy, option lists, and small lookup tables in
// one place. Centralized deliberately: English today, but every user-facing
// string lives here (not scattered across JSX) so a future Spanish
// translation is a matter of adding a parallel table, not hunting through
// components. See the README/PR notes for the i18n follow-up plan.
//
// Nothing in this file does I/O — pure constants and types, safe to import
// from both server and client components.

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

// ---------------------------------------------------------------------------
// Step copy
// ---------------------------------------------------------------------------

export const ONBOARDING_COPY = {
  step1: {
    title: "Your place",
    subtitle: "Let's set up {restaurantName}.",
    conceptLabel: "What best describes it?",
    countryLabel: "Where are you located?",
    countryPlaceholder: "Select a country",
    languageLabel: "What language should Milton use?",
  },
  step2: {
    title: "Your operation",
    locationsLabel: "How many locations?",
    posLabel: "What POS system do you use?",
  },
  step3: {
    title: "What should Milton help with?",
    subtitle: `Pick up to ${MAX_PRIORITIES}.`,
  },
  step4: {
    heading: "Milton is ready for {restaurantName}.",
    subtitle: "Here's a good place to start:",
  },
  nav: {
    back: "Back",
    next: "Next",
    skip: "Skip",
    finish: "Let's go",
    saving: "Setting up...",
  },
} as const;

// ---------------------------------------------------------------------------
// Option lists — each option carries the label shown to the user. Icons are
// wired up in the component layer (icon components aren't serializable
// copy, so they don't belong in this file).
// ---------------------------------------------------------------------------

export const CONCEPT_TYPE_OPTIONS: { value: ConceptType; label: string }[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "bar", label: "Bar" },
  { value: "cafe", label: "Café" },
  { value: "bakery", label: "Bakery" },
  { value: "fast_casual", label: "Fast casual" },
  { value: "other", label: "Other" },
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
  { value: "other", label: "Other" },
  { value: "unknown", label: "I don't know" },
];

export const PRIORITY_OPTIONS: { value: PriorityKey; label: string }[] = [
  { value: "margins", label: "Understand my margins" },
  { value: "food_cost", label: "Control food costs" },
  { value: "sales", label: "Understand sales" },
  { value: "inventory", label: "Track inventory" },
  { value: "waste", label: "Reduce waste" },
  { value: "forecast", label: "Forecast demand" },
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
  { code: "MX", label: "Mexico", currency: "MXN" },
  { code: "US", label: "United States", currency: "USD" },
  { code: "CA", label: "Canada", currency: "CAD" },
  { code: "AR", label: "Argentina", currency: "ARS" },
  { code: "BR", label: "Brazil", currency: "BRL" },
  { code: "CL", label: "Chile", currency: "CLP" },
  { code: "CO", label: "Colombia", currency: "COP" },
  { code: "SV", label: "El Salvador", currency: "USD" },
  { code: "GT", label: "Guatemala", currency: "GTQ" },
  { code: "ES", label: "Spain", currency: "EUR" },
  { code: "DE", label: "Germany", currency: "EUR" },
  { code: "IT", label: "Italy", currency: "EUR" },
  { code: "CH", label: "Switzerland", currency: "CHF" },
  { code: "PE", label: "Peru", currency: "PEN" },
  { code: "GB", label: "United Kingdom", currency: "GBP" },
  { code: "PT", label: "Portugal", currency: "EUR" },
  { code: "OTHER", label: "Other", currency: "USD" },
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
export function getNextStepCards(posSystem: PosSystemChoice): NextStepCard[] {
  const connectPos: NextStepCard =
    posSystem === "odoo"
      ? {
          key: "connect_pos",
          title: "Connect my POS",
          description:
            "Odoo sync is on its way — upload a sales export to get started today.",
          href: "/dashboard/restaurant/upload",
          cta: "Upload sales",
        }
      : {
          key: "connect_pos",
          title: "Connect my POS",
          description: "Bring in your sales data to unlock real numbers.",
          href: "/dashboard/restaurant/upload",
          cta: "Get started",
        };

  const uploadSales: NextStepCard = {
    key: "upload_sales",
    title: "Upload sales",
    description: "Import a POS export and see your dashboard come alive.",
    href: "/dashboard/restaurant/upload",
    cta: "Upload now",
  };

  const addRecipes: NextStepCard = {
    key: "add_recipes",
    title: "Add recipes & costs",
    description: "Build recipes so Milton can calculate real margins.",
    href: "/dashboard/restaurant/menu",
    cta: "Add recipes",
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
