// lib/restaurant/onboarding-copy.ts
//
// All restaurant onboarding copy, option lists, and small lookup tables in
// one place. Centralized deliberately: Spanish (tú) since R1; every user-facing
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
    title: "Tu restaurante",
    subtitle: "Vamos a configurar {restaurantName}.",
    conceptLabel: "¿Qué lo describe mejor?",
    countryLabel: "¿Dónde está?",
    countryPlaceholder: "Elige un país",
    languageLabel: "¿En qué idioma te habla Milton?",
  },
  step2: {
    title: "Tu operación",
    locationsLabel: "¿Cuántos locales tienes?",
    posLabel: "¿Qué sistema de punto de venta usas?",
  },
  step3: {
    title: "¿En qué te ayuda Milton?",
    subtitle: `Elige hasta ${MAX_PRIORITIES}.`,
  },
  step4: {
    heading: "Milton está listo para {restaurantName}.",
    subtitle: "Un buen lugar para empezar:",
  },
  nav: {
    back: "Atrás",
    next: "Siguiente",
    skip: "Omitir",
    finish: "Vamos",
    saving: "Configurando…",
  },
} as const;

// ---------------------------------------------------------------------------
// Option lists — each option carries the label shown to the user. Icons are
// wired up in the component layer (icon components aren't serializable
// copy, so they don't belong in this file).
// ---------------------------------------------------------------------------

export const CONCEPT_TYPE_OPTIONS: { value: ConceptType; label: string }[] = [
  { value: "restaurant", label: "Restaurante" },
  { value: "bar", label: "Bar" },
  { value: "cafe", label: "Café" },
  { value: "bakery", label: "Panadería" },
  { value: "fast_casual", label: "Comida rápida" },
  { value: "other", label: "Otro" },
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
  { value: "other", label: "Otro" },
  { value: "unknown", label: "No sé" },
];

export const PRIORITY_OPTIONS: { value: PriorityKey; label: string }[] = [
  { value: "margins", label: "Entender mis márgenes" },
  { value: "food_cost", label: "Controlar el costo de comida" },
  { value: "sales", label: "Entender mis ventas" },
  { value: "inventory", label: "Llevar mi inventario" },
  { value: "waste", label: "Reducir desperdicio" },
  { value: "forecast", label: "Pronosticar la demanda" },
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
  { code: "MX", label: "México", currency: "MXN" },
  { code: "US", label: "Estados Unidos", currency: "USD" },
  { code: "CA", label: "Canadá", currency: "CAD" },
  { code: "AR", label: "Argentina", currency: "ARS" },
  { code: "BR", label: "Brasil", currency: "BRL" },
  { code: "CL", label: "Chile", currency: "CLP" },
  { code: "CO", label: "Colombia", currency: "COP" },
  { code: "SV", label: "El Salvador", currency: "USD" },
  { code: "GT", label: "Guatemala", currency: "GTQ" },
  { code: "ES", label: "España", currency: "EUR" },
  { code: "DE", label: "Alemania", currency: "EUR" },
  { code: "IT", label: "Italia", currency: "EUR" },
  { code: "CH", label: "Suiza", currency: "CHF" },
  { code: "PE", label: "Perú", currency: "PEN" },
  { code: "GB", label: "Reino Unido", currency: "GBP" },
  { code: "PT", label: "Portugal", currency: "EUR" },
  { code: "OTHER", label: "Otro", currency: "USD" },
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
          title: "Conecta tu POS",
          description:
            "Conecta Odoo o sube un archivo de ventas para empezar hoy.",
          href: "/dashboard/restaurant/upload",
          cta: "Subir ventas",
        }
      : {
          key: "connect_pos",
          title: "Conecta tu POS",
          description: "Trae tus ventas para ver números reales.",
          href: "/dashboard/restaurant/upload",
          cta: "Empezar",
        };

  const uploadSales: NextStepCard = {
    key: "upload_sales",
    title: "Sube tus ventas",
    description:
      "Importa un archivo del POS y mira tu Cockpit con datos reales.",
    href: "/dashboard/restaurant/upload",
    cta: "Subir ahora",
  };

  const addRecipes: NextStepCard = {
    key: "add_recipes",
    title: "Agrega recetas y costos",
    description: "Arma tus recetas para que Milton calcule márgenes reales.",
    href: "/dashboard/restaurant/menu",
    cta: "Agregar recetas",
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
