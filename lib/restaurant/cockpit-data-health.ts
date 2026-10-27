// lib/restaurant/cockpit-data-health.ts
//
// Backend readiness for the compact Data Health indicator + drawer.
// The UI never guesses these items.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { formatLastSyncedAgo } from "@/lib/restaurant/last-synced";

export type DataHealthTone = "ok" | "warn" | "error";

export interface DataHealthItem {
  id: string;
  label: string;
  detail: string;
  tone: DataHealthTone;
  /** Counts toward "N asuntos". */
  issue: boolean;
  tooltip?: string;
}

export interface CockpitDataHealth {
  tone: DataHealthTone;
  issue_count: number;
  items: DataHealthItem[];
}

export interface DataHealthInput {
  lang: PreferredLanguage;
  currency: string;
  saleLineCount: number;
  otherCurrencyExcluded: number;
  dishesWithoutRecipe: number;
  recipeCoveragePct: number | null;
  /** Sales-weighted cost coverage for the SELECTED cockpit period. */
  costCoveragePct: number;
  /** All-time cost coverage, shown separately when provided. */
  allTimeCostCoveragePct?: number | null;
  ingredientsWithCost?: number | null;
  ingredientsTotal?: number | null;
  lastSyncedAt: string | null;
  posConnected: boolean;
  salesLoaded: boolean;
  readError: boolean;
  truncated: boolean;
  now?: Date;
}

export function buildCockpitDataHealth(
  input: DataHealthInput
): CockpitDataHealth {
  const lang = input.lang;
  const items: DataHealthItem[] = [];

  items.push({
    id: "pos",
    label: t(lang, "POS connected", "POS conectado"),
    detail: input.posConnected
      ? t(lang, "Active POS connection.", "Hay una conexión POS activa.")
      : t(lang, "No active POS connection.", "No hay una conexión POS activa."),
    tone: input.posConnected ? "ok" : "warn",
    issue: !input.posConnected,
  });

  items.push({
    id: "sales",
    label: t(lang, "Sales synced", "Ventas sincronizadas"),
    detail: input.salesLoaded
      ? t(lang, "Sales rows are loaded.", "Las ventas ya están cargadas.")
      : t(lang, "No sales rows loaded yet.", "Aún no hay ventas cargadas."),
    tone: input.salesLoaded ? "ok" : input.readError ? "error" : "warn",
    issue: !input.salesLoaded || input.readError,
  });

  items.push({
    id: "currency",
    label: t(lang, `Currency ${input.currency}`, `Divisa ${input.currency}`),
    detail: t(
      lang,
      "Company currency. Rows in another currency are excluded, not converted.",
      "Divisa de la empresa. Las filas en otra divisa se excluyen; no se convierten."
    ),
    tone: "ok",
    issue: false,
  });

  items.push({
    id: "lines",
    label: t(
      lang,
      `${input.saleLineCount.toLocaleString(lang === "es" ? "es-MX" : "en-US")} sale lines`,
      `${input.saleLineCount.toLocaleString("es-MX")} líneas de venta`
    ),
    detail: t(
      lang,
      "POS lines in the loaded company data.",
      "Líneas del POS en los datos cargados de la empresa."
    ),
    tone: input.saleLineCount > 0 ? "ok" : "warn",
    issue: input.saleLineCount === 0,
  });

  items.push({
    id: "fx_excluded",
    label:
      input.otherCurrencyExcluded > 0
        ? t(
            lang,
            `${input.otherCurrencyExcluded} rows in another currency excluded`,
            `${input.otherCurrencyExcluded} ${input.otherCurrencyExcluded === 1 ? "fila en otra divisa excluida" : "filas en otra divisa excluidas"}`
          )
        : t(lang, "No other-currency rows", "No hay filas en otra divisa"),
    detail: t(
      lang,
      "Mixed-currency rows are dropped from totals. There is no FX conversion.",
      "Las filas en otra divisa no entran en los totales. No hay conversión de tipo de cambio."
    ),
    tone: input.otherCurrencyExcluded > 0 ? "warn" : "ok",
    issue: input.otherCurrencyExcluded > 0,
  });

  items.push({
    id: "no_recipe",
    label:
      input.dishesWithoutRecipe > 0
        ? t(
            lang,
            `${input.dishesWithoutRecipe} dishes without a recipe`,
            `${input.dishesWithoutRecipe} ${input.dishesWithoutRecipe === 1 ? "plato sin receta" : "platos sin receta"}`
          )
        : t(
            lang,
            "Every sold dish has a recipe",
            "Todos los platos vendidos tienen receta"
          ),
    detail: t(
      lang,
      "Sold dishes without a recipe cannot be costed.",
      "Los platos vendidos sin receta no se pueden costear."
    ),
    tone: input.dishesWithoutRecipe > 0 ? "warn" : "ok",
    issue: input.dishesWithoutRecipe > 0,
  });

  const recipePct =
    input.recipeCoveragePct === null
      ? null
      : Math.round(input.recipeCoveragePct * 10) / 10;
  items.push({
    id: "recipe_coverage",
    label:
      recipePct === null
        ? t(
            lang,
            "Recipe coverage unavailable",
            "Cobertura de recetas no disponible"
          )
        : t(
            lang,
            `Recipe coverage ${recipePct.toFixed(1)}% — sold dishes with a recipe`,
            `Cobertura de recetas ${recipePct.toFixed(1)}% — platos vendidos con receta`
          ),
    detail: t(
      lang,
      "Share of net sales from sold dishes that have a recipe.",
      "Parte de las ventas netas que viene de platos vendidos con receta."
    ),
    tone: recipePct === null ? "warn" : recipePct < 80 ? "warn" : "ok",
    issue: recipePct === null || recipePct < 80,
  });

  const costPct = Math.round(input.costCoveragePct * 10) / 10;
  const ingredientTooltip =
    input.ingredientsWithCost != null &&
    input.ingredientsTotal != null &&
    input.ingredientsTotal > 0
      ? t(
          lang,
          `${input.ingredientsWithCost} of ${input.ingredientsTotal} ingredients have a cost`,
          `${input.ingredientsWithCost} de ${input.ingredientsTotal} ingredientes con costo`
        )
      : undefined;
  items.push({
    id: "cost_coverage",
    label: t(
      lang,
      `Cost coverage ${costPct.toFixed(1)}% of this period`,
      `Cobertura de costos ${costPct.toFixed(1)}% de este periodo`
    ),
    detail: t(
      lang,
      "Share of net sales in the selected period from dishes that have a cost — not the share of ingredients mapped.",
      "Parte de las ventas netas del periodo seleccionado que viene de platos con costo — no el porcentaje de ingredientes ligados."
    ),
    tone: costPct === 0 ? "warn" : costPct < 80 ? "warn" : "ok",
    issue: costPct < 80,
    tooltip: ingredientTooltip,
  });

  if (
    input.allTimeCostCoveragePct != null &&
    Number.isFinite(input.allTimeCostCoveragePct)
  ) {
    const allTimePct = Math.round(input.allTimeCostCoveragePct * 10) / 10;
    items.push({
      id: "cost_coverage_all_time",
      label: t(
        lang,
        `All-time cost coverage ${allTimePct.toFixed(1)}% of sales`,
        `Cobertura de costos histórica ${allTimePct.toFixed(1)}% de las ventas`
      ),
      detail: t(
        lang,
        "All loaded sales, not just the selected period.",
        "Todas las ventas cargadas, no solo el periodo seleccionado."
      ),
      tone: allTimePct === 0 ? "warn" : allTimePct < 80 ? "warn" : "ok",
      issue: false,
    });
  }

  const lastSync = formatLastSyncedAgo(
    input.lastSyncedAt,
    input.now ?? new Date(),
    lang
  );
  items.push({
    id: "last_sync",
    label: t(lang, "Last sync", "Última sincronización"),
    detail:
      lastSync ??
      t(lang, "No sync timestamp yet.", "Aún no hay hora de sincronización."),
    tone: input.lastSyncedAt ? "ok" : "warn",
    issue: !input.lastSyncedAt,
  });

  if (input.readError) {
    items.unshift({
      id: "read_error",
      label: t(
        lang,
        "Totals are unavailable",
        "Los totales no están disponibles"
      ),
      detail: t(
        lang,
        "Could not load all sales rows. Totals are unavailable — they are not a smaller number from a partial read.",
        "No se pudieron cargar todas las ventas. Los totales no están disponibles: no son un número más chico de una lectura parcial."
      ),
      tone: "error",
      issue: true,
    });
  } else if (input.truncated) {
    items.unshift({
      id: "truncated",
      label: t(
        lang,
        "Totals may be incomplete",
        "Los totales pueden estar incompletos"
      ),
      detail: t(
        lang,
        "This view stopped after the safety cap. The numbers shown are partial.",
        "Esta vista se detuvo al llegar al tope de seguridad. Los números que ves son parciales."
      ),
      tone: "error",
      issue: true,
    });
  }

  const issueCount = items.filter((item) => item.issue).length;
  let tone: DataHealthTone = "ok";
  if (items.some((item) => item.tone === "error")) tone = "error";
  else if (issueCount > 0) tone = "warn";

  return { tone, issue_count: issueCount, items };
}
