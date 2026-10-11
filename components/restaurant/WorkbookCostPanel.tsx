import { handmadeNoLongerComparedNote } from "@/lib/restaurant/cost-workbook/copy";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { isImportProtectedSource } from "@/lib/restaurant/protect-imported-recipe";
import type { MenuItemCostResult } from "@/types/restaurant-costing";

function money(
  value: number | null | undefined,
  currency: string | null
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const safe = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return new Intl.NumberFormat(safe === "MXN" ? "es-MX" : "en-US", {
    style: "currency",
    currency: safe,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function WorkbookCostPanel({
  lang,
  currency,
  cost,
  workbook,
  batchLabel = false,
}: {
  lang: PreferredLanguage;
  currency?: string | null;
  cost?: Pick<MenuItemCostResult, "cost" | "status"> | null;
  workbook?: {
    excel_cost: number | null;
    milton_cost: number | null;
    match: "match" | "mismatch" | null;
    source_type: string | null;
  } | null;
  batchLabel?: boolean;
}) {
  const live =
    cost?.status === "complete" && cost.cost != null ? cost.cost : null;
  const milton = live ?? workbook?.milton_cost ?? null;
  const handmade = isImportProtectedSource(workbook?.source_type);
  const imported = workbook?.source_type === "import";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm space-y-1">
      <p>
        <span className="text-muted-foreground">
          {batchLabel
            ? t(lang, "Computed batch cost", "Costo de lote calculado")
            : t(lang, "Computed cost", "Costo calculado")}
          :{" "}
        </span>
        <span className="tabular-nums font-medium">
          {money(milton, currency ?? null)}
        </span>
        {cost && cost.status !== "complete" ? (
          <span className="text-xs text-amber-700 dark:text-amber-300 ml-2">
            {cost.status === "workbook_mismatch"
              ? t(lang, "does not match the Excel", "no coincide con el Excel")
              : t(lang, "cost incomplete", "costo incompleto")}
          </span>
        ) : null}
      </p>
      {imported || workbook?.excel_cost != null ? (
        <p>
          <span className="text-muted-foreground">
            {t(lang, "Excel COSTO TOTAL", "COSTO TOTAL del Excel")}:{" "}
          </span>
          <span className="tabular-nums font-medium">
            {money(workbook?.excel_cost ?? null, currency ?? null)}
          </span>
          {handmade ? (
            <span className="ml-2 text-xs text-muted-foreground">
              {handmadeNoLongerComparedNote(lang)}
            </span>
          ) : workbook?.match === "match" ? (
            <span className="ml-2 text-xs text-green-700 dark:text-green-300">
              {t(lang, "matches the Excel", "coincide con el Excel")}
            </span>
          ) : workbook?.match === "mismatch" ? (
            <span className="ml-2 text-xs text-red-700 dark:text-red-300">
              {t(lang, "does not match the Excel", "no coincide con el Excel")}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
