// components/restaurant/settings/PosSalesUploadPanel.tsx
//
// "Subir ventas (archivo)" in Configuración › Conexiones (R1-09b, A10).
// Was the standalone /dashboard/restaurant/upload page (that URL now
// redirects here). Posts a Revel-style item-level export to
// /api/restaurant/pos/upload; the server does the parsing.

"use client";

import { useState } from "react";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCan } from "@/components/restaurant/shell/shell-chrome-context";
import { SALES_UPLOAD_DENIED_MESSAGE } from "@/lib/restaurant/pos-upload-messages";
import {
  localeFor,
  t,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { userErrorMessage } from "@/lib/restaurant/user-error";

interface UploadSummary {
  inserted_rows: number;
  /** Rows deleted before insert when replace_existing was true. */
  deleted_rows: number;
  unique_orders: number;
  total_revenue: number;
  unmatched_menu_items: string[];
  unmatched_locations: string[];
  validation_errors: Array<{
    rowIndex: number;
    reason: string;
    rawOrderNumber?: string;
  }>;
  resolved_columns: Record<string, string>;
  total_rows_in_file: number;
  replace_existing: boolean;
  currency?: string;
}

interface UploadError {
  error: string;
  missing?: string[];
  headers?: string[];
  details?: string;
  validation_errors?: Array<{
    rowIndex: number;
    reason: string;
    rawOrderNumber?: string;
  }>;
}

const REQUIRED_COLUMNS = [
  "Order_Number",
  "Order_Date",
  "Product_Name",
  "Product_Quantity",
  "Gross_Item_Total / Total_Sales",
];

function moneyFmt(currency: string, locale: string) {
  const safe = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: safe,
    minimumFractionDigits: 0,
  });
}

interface MappingPreview {
  needs_mapping: boolean;
  header_fingerprint: string;
  headers: string[];
  sample_rows: Record<string, unknown>[];
  date_format: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  date_format_ambiguous: boolean;
  decimal_separator: "comma" | "dot";
  message?: string;
}

interface ColumnMapping {
  date?: string;
  product?: string;
  quantity?: string;
  net_amount?: string;
  location?: string;
  category?: string;
  sub_category?: string;
  order_id?: string;
  payment_type?: string;
  gross_amount?: string;
  discount?: string;
  tax?: string;
}

type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

export function PosSalesUploadPanel({ lang }: { lang: PreferredLanguage }) {
  const canUpload = useCan("imports.run");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(true);

  // Mapping flow state
  const [mappingPreview, setMappingPreview] = useState<MappingPreview | null>(
    null
  );
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD/MM/YYYY");
  const [mappingName, setMappingName] = useState("");
  const [loadingMapping, setLoadingMapping] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setSummary(null);
    setError(null);
    setMappingPreview(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("replace_existing", replaceExisting ? "true" : "false");
      const res = await fetch("/api/restaurant/pos/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      const json = await res.json();

      // Check if we need column mapping
      if (json.needs_mapping) {
        const preview = json as MappingPreview;
        setMappingPreview(preview);
        setDateFormat(preview.date_format || "DD/MM/YYYY");
        // Get AI suggestions
        await getSuggestedMapping(json.headers, json.sample_rows);
      } else if (!res.ok) {
        const raw = json as UploadError;
        setError({
          ...raw,
          error: userErrorMessage(
            raw,
            t(
              lang,
              "Could not upload the file. Try again.",
              "No se pudo subir el archivo. Inténtalo de nuevo.",
              "Die Datei konnte nicht hochgeladen werden. Bitte versuchen Sie es erneut."
            )
          ),
        });
      } else {
        setSummary(json as UploadSummary);
      }
    } catch (err) {
      setError({
        error: t(lang, "Network error", "Error de red", "Netzwerkfehler"),
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function getSuggestedMapping(
    headers: string[],
    sampleRows: Record<string, unknown>[]
  ) {
    setLoadingMapping(true);
    try {
      const res = await fetch("/api/restaurant/pos/upload/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers, sample_rows: sampleRows }),
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        setColumnMapping(json.suggested_mapping || {});
      }
    } catch (err) {
      console.error("Error getting mapping suggestions:", err);
    } finally {
      setLoadingMapping(false);
    }
  }

  async function handleConfirmMapping() {
    if (!file || !mappingPreview) return;
    setSubmitting(true);
    setError(null);
    try {
      // Convert file to base64
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/restaurant/pos/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_data: fileData,
          file_name: file.name,
          column_mapping: columnMapping,
          date_format: dateFormat,
          decimal_separator: mappingPreview.decimal_separator,
          mapping_name: mappingName || undefined,
          replace_existing: replaceExisting,
        }),
        credentials: "include",
      });

      const json = await res.json();
      if (!res.ok) {
        setError({
          error: json.error || "Error al confirmar el mapeo",
          details: json.details,
        });
      } else {
        setSummary(json as UploadSummary);
        setMappingPreview(null);
      }
    } catch (err) {
      setError({
        error: t(lang, "Network error", "Error de red", "Netzwerkfehler"),
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  const errorRows = (rows: UploadSummary["validation_errors"]) => (
    <ul className="text-xs text-muted-foreground space-y-0.5 max-h-40 overflow-y-auto">
      {rows.slice(0, 50).map((e, i) => (
        <li key={i}>
          {t(lang, "Row", "Fila", "Zeile")} {e.rowIndex + 2}: {e.reason}
          {e.rawOrderNumber ? ` (${e.rawOrderNumber})` : ""}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap items-center gap-1.5"
        title={t(
          lang,
          "CSV or XLSX, Revel Customer Items export. Optional: Establishment, POS_Station, Order_Type, Payment_Type, Discount, Total_Product_Tax.",
          "CSV o XLSX, exportación Customer Items de Revel. Opcionales: Establishment, POS_Station, Order_Type, Payment_Type, Discount, Total_Product_Tax.",
          "CSV oder XLSX, Export „Customer Items“ von Revel. Optional: Establishment, POS_Station, Order_Type, Payment_Type, Discount, Total_Product_Tax."
        )}
      >
        <span className="text-xs text-muted-foreground">
          {t(lang, "Columns:", "Columnas:", "Spalten:")}
        </span>
        {REQUIRED_COLUMNS.map((c) => (
          <Badge key={c} variant="outline" className="text-xs font-mono">
            {c}
          </Badge>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          aria-label={t(lang, "Sales file", "Archivo de ventas", "Umsatzdatei")}
          disabled={!canUpload}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setSummary(null);
            setError(null);
          }}
          className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/70"
        />
        <label
          className="flex items-center gap-2 cursor-pointer select-none text-sm"
          title={t(
            lang,
            "Deletes this company's previous POS sales rows so the same file is not counted twice.",
            "Borra las ventas del POS anteriores para no contar el mismo archivo dos veces.",
            "Löscht die bisherigen Kassenumsätze, damit dieselbe Datei nicht doppelt gezählt wird."
          )}
        >
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          {t(
            lang,
            "Replace previous sales",
            "Reemplazar las ventas anteriores",
            "Bisherige Umsätze ersetzen"
          )}
        </label>
        {!replaceExisting && (
          <p className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/30 dark:text-gray-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t(
              lang,
              "The same file twice doubles revenue.",
              "Subir el mismo archivo dos veces duplica las ventas.",
              "Dieselbe Datei zweimal hochzuladen verdoppelt den Umsatz."
            )}
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          disabled={!file || submitting || !canUpload}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          {submitting
            ? t(lang, "Uploading…", "Subiendo…", "Wird hochgeladen …")
            : t(lang, "Upload sales", "Subir ventas", "Umsätze hochladen")}
        </Button>
        {!canUpload && (
          <p className="text-[13px] text-[#6b7280]">
            {SALES_UPLOAD_DENIED_MESSAGE}
          </p>
        )}
      </form>

      {error && (
        <div className="space-y-2 rounded-md border border-[#0F172A] px-3 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-[#0F172A]">
            <AlertTriangle className="h-4 w-4" />
            {error.error}
          </p>
          {error.details && (
            <p className="text-sm text-muted-foreground">{error.details}</p>
          )}
          {error.missing && error.missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm">
                {t(
                  lang,
                  "Missing columns:",
                  "Faltan columnas:",
                  "Fehlende Spalten:"
                )}
              </span>
              {error.missing.map((m) => (
                <Badge
                  key={m}
                  variant="outline"
                  className="text-xs font-mono border-[#0F172A] text-[#0F172A]"
                >
                  {m}
                </Badge>
              ))}
            </div>
          )}
          {error.headers && (
            <p className="text-xs text-muted-foreground font-mono">
              {t(
                lang,
                "Your file has:",
                "Tu archivo tiene:",
                "Ihre Datei enthält:"
              )}{" "}
              {error.headers.join(", ")}
            </p>
          )}
          {error.validation_errors && error.validation_errors.length > 0
            ? errorRows(error.validation_errors)
            : null}
        </div>
      )}

      {mappingPreview && (
        <div className="space-y-4 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 px-4 py-4">
          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">
              {t(
                lang,
                "Column mapping required",
                "Se requiere mapeo de columnas",
                "Spaltenzuordnung erforderlich"
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t(
                lang,
                "This file format is different from Revel. Please map the columns below, then confirm.",
                "Este archivo tiene un formato distinto a Revel. Por favor, mapea las columnas abajo y luego confirma.",
                "Dieses Dateiformat unterscheidet sich von Revel. Bitte ordnen Sie die Spalten unten zu und bestätigen Sie."
              )}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm">
              {t(
                lang,
                "Mapping name (optional):",
                "Nombre del mapeo (opcional):",
                "Name der Zuordnung (optional):"
              )}
            </label>
            <input
              type="text"
              value={mappingName}
              onChange={(e) => setMappingName(e.target.value)}
              placeholder={t(
                lang,
                "e.g. Fuel POS",
                "ej. POS Fuel",
                "z.B. Fuel POS"
              )}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">
              {t(
                lang,
                "Map file columns to fields:",
                "Mapea las columnas del archivo a los campos:",
                "Dateispalten Feldern zuordnen:"
              )}
            </p>
            {loadingMapping && (
              <p className="text-sm text-muted-foreground">
                {t(
                  lang,
                  "Loading AI suggestions...",
                  "Cargando sugerencias de IA...",
                  "KI-Vorschläge werden geladen..."
                )}
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <MappingField
                label={`${t(lang, "Date", "Fecha", "Datum")} *`}
                field="date"
                headers={mappingPreview.headers}
                value={columnMapping.date || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, date: val })
                }
              />
              <MappingField
                label={`${t(lang, "Product", "Plato", "Produkt")} *`}
                field="product"
                headers={mappingPreview.headers}
                value={columnMapping.product || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, product: val })
                }
              />
              <MappingField
                label={`${t(lang, "Quantity", "Cantidad", "Menge")} *`}
                field="quantity"
                headers={mappingPreview.headers}
                value={columnMapping.quantity || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, quantity: val })
                }
              />
              <MappingField
                label={`${t(lang, "Net Amount", "Importe Neto", "Nettobetrag")} *`}
                field="net_amount"
                headers={mappingPreview.headers}
                value={columnMapping.net_amount || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, net_amount: val })
                }
              />
              <MappingField
                label={t(lang, "Location", "Local", "Standort")}
                field="location"
                headers={mappingPreview.headers}
                value={columnMapping.location || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, location: val })
                }
              />
              <MappingField
                label={t(lang, "Category", "Categoría", "Kategorie")}
                field="category"
                headers={mappingPreview.headers}
                value={columnMapping.category || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, category: val })
                }
              />
              <MappingField
                label={t(lang, "Order ID", "ID de Orden", "Bestellnummer")}
                field="order_id"
                headers={mappingPreview.headers}
                value={columnMapping.order_id || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, order_id: val })
                }
              />
              <MappingField
                label={t(lang, "Payment Type", "Tipo de Pago", "Zahlungsart")}
                field="payment_type"
                headers={mappingPreview.headers}
                value={columnMapping.payment_type || ""}
                onChange={(val) =>
                  setColumnMapping({ ...columnMapping, payment_type: val })
                }
              />
            </div>
          </div>

          {mappingPreview.sample_rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t(lang, "Sample data:", "Datos de muestra:", "Beispieldaten:")}
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr className="border-b">
                      {mappingPreview.headers.slice(0, 8).map((h) => (
                        <th key={h} className="text-left px-2 py-1 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappingPreview.sample_rows.slice(0, 3).map((row, i) => (
                      <tr key={i} className="border-b">
                        {mappingPreview.headers.slice(0, 8).map((h) => (
                          <td key={h} className="px-2 py-1">
                            {String(row[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleConfirmMapping}
              disabled={
                submitting ||
                !columnMapping.date ||
                !columnMapping.product ||
                !columnMapping.quantity ||
                !columnMapping.net_amount
              }
              className="gap-2"
            >
              {submitting
                ? t(lang, "Importing...", "Importando...", "Wird importiert...")
                : t(
                    lang,
                    "Confirm and import",
                    "Confirmar e importar",
                    "Bestätigen und importieren"
                  )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMappingPreview(null);
                setColumnMapping({});
                setMappingName("");
              }}
              disabled={submitting}
            >
              {t(lang, "Cancel", "Cancelar", "Abbrechen")}
            </Button>
          </div>
        </div>
      )}

      {summary && (
        <div className="space-y-3 rounded-md border border-[#A7F3D0] px-3 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-[#0F172A]">
            <CheckCircle2 className="h-4 w-4" />
            {t(
              lang,
              "Upload complete",
              "Ventas cargadas",
              "Upload abgeschlossen"
            )}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat
              label={t(
                lang,
                "Rows inserted",
                "Filas cargadas",
                "Zeilen importiert"
              )}
              value={summary.inserted_rows.toLocaleString(localeFor(lang))}
            />
            <Stat
              label={t(lang, "Orders", "Órdenes", "Bestellungen")}
              value={summary.unique_orders.toLocaleString(localeFor(lang))}
            />
            <Stat
              label={t(lang, "Sales", "Ventas", "Umsatz")}
              value={moneyFmt(
                summary.currency ?? "USD",
                localeFor(lang)
              ).format(summary.total_revenue)}
            />
            <Stat
              label={t(
                lang,
                "Rows in file",
                "Filas en el archivo",
                "Zeilen in der Datei"
              )}
              value={summary.total_rows_in_file.toLocaleString(localeFor(lang))}
            />
            <Stat
              label={t(
                lang,
                "Rows replaced",
                "Filas reemplazadas",
                "Zeilen ersetzt"
              )}
              value={summary.deleted_rows.toLocaleString(localeFor(lang))}
            />
          </div>
          {summary.unmatched_menu_items.length > 0 && (
            <ItemList
              label={t(
                lang,
                `Unmatched dishes (${summary.unmatched_menu_items.length})`,
                `Platos sin vincular (${summary.unmatched_menu_items.length})`,
                `Nicht zugeordnete Gerichte (${summary.unmatched_menu_items.length})`
              )}
              items={summary.unmatched_menu_items}
            />
          )}
          {summary.unmatched_locations.length > 0 && (
            <ItemList
              label={t(
                lang,
                `Unmatched locations (${summary.unmatched_locations.length})`,
                `Locales sin vincular (${summary.unmatched_locations.length})`,
                `Nicht zugeordnete Standorte (${summary.unmatched_locations.length})`
              )}
              items={summary.unmatched_locations}
            />
          )}
          {summary.validation_errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t(
                  lang,
                  `Skipped rows (${summary.validation_errors.length})`,
                  `Filas omitidas (${summary.validation_errors.length})`,
                  `Übersprungene Zeilen (${summary.validation_errors.length})`
                )}
              </p>
              {errorRows(summary.validation_errors)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-0.5">{value}</p>
    </div>
  );
}

function ItemList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
        {items.slice(0, 100).map((it) => (
          <Badge key={it} variant="outline" className="text-xs">
            {it}
          </Badge>
        ))}
        {items.length > 100 && (
          <span className="text-xs text-muted-foreground self-center">
            + {items.length - 100}
          </span>
        )}
      </div>
    </div>
  );
}

function MappingField({
  label,
  field,
  headers,
  value,
  onChange,
}: {
  label: string;
  field: string;
  headers: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium" htmlFor={`mapping-${field}`}>
        {label}
      </label>
      <select
        id={`mapping-${field}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
      >
        <option value="">-- Sin mapear --</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </div>
  );
}
