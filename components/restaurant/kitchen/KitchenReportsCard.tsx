"use client";

// components/restaurant/kitchen/KitchenReportsCard.tsx
//
// Newest 50 cook reports, filterable by location and type. Photos and
// voice notes load through the company-checked media proxy
// (/api/restaurant/kitchen/reports/[id]/media). Owners and Milton admins
// can reclassify a report (PATCH). No push notifications, no AI.

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Report {
  id: string;
  report_type: string;
  text: string | null;
  media_kind: "photo" | "voice" | null;
  /** Where the report came from; absent before migration 068. */
  channel?: string;
  created_at: string;
  staff_name: string;
  location_name: string;
}

function typeLabels(lang: PreferredLanguage): Record<string, string> {
  return {
    running_out: t(lang, "Running low", "Se agota", "Wird knapp"),
    "86": "86",
    waste: t(lang, "Waste", "Merma", "Ausschuss"),
    unclassified: t(
      lang,
      "Unclassified",
      "Sin clasificar",
      "Nicht klassifiziert"
    ),
  };
}

export const KITCHEN_LOW_STOCK_TYPES = ["running_out", "86"] as const;

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

export function KitchenReportsCard({
  canManage,
  locations,
  initialType = "",
  includeTypes,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
  initialType?: string;
  /** When set and the type filter is empty, fetch each type (API caps at 50) and merge. */
  includeTypes?: readonly string[];
}) {
  const { lang, locale } = useT();
  const TYPE_LABELS = typeLabels(lang);
  const [reports, setReports] = useState<Report[]>([]);
  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState(initialType);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const typesToFetch =
        type !== "" ? [type] : includeTypes?.length ? [...includeTypes] : [""];
      const pages = await Promise.all(
        typesToFetch.map(async (reportType) => {
          const params = new URLSearchParams();
          if (locationId) params.set("location_id", locationId);
          if (reportType) params.set("type", reportType);
          const res = await fetch(`/api/restaurant/kitchen/reports?${params}`);
          if (!res.ok) return null;
          const data = (await res.json()) as { reports?: Report[] };
          return data.reports ?? [];
        })
      );
      if (cancelled) return;
      if (pages.some((page) => page === null)) {
        setError(
          t(
            lang,
            "Could not load the reports.",
            "No se pudieron cargar los reportes.",
            "Die Meldungen konnten nicht geladen werden."
          )
        );
        return;
      }
      const byId = new Map<string, Report>();
      for (const page of pages) {
        for (const row of page ?? []) byId.set(row.id, row);
      }
      const merged = [...byId.values()].sort((a, b) =>
        b.created_at.localeCompare(a.created_at)
      );
      setError(null);
      setReports(merged);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, type, reloadKey, includeTypes]);

  const reclassify = async (id: string, report_type: string) => {
    const res = await fetch(`/api/restaurant/kitchen/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_type }),
    });
    if (!res.ok)
      setError(
        t(
          lang,
          "Could not update the report.",
          "No se pudo actualizar el reporte.",
          "Die Meldung konnte nicht aktualisiert werden."
        )
      );
    setReloadKey((k) => k + 1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(lang, "Reports", "Reportes", "Meldungen")}</CardTitle>
        <CardDescription>
          {t(
            lang,
            "Dishes running out, 86 and waste reported by your cooks.",
            "Platos que se acaban, 86 y merma que reportan tus cocineros.",
            "Von Ihren Köchen gemeldete ausgehende Gerichte, 86 und Ausschuss."
          )}
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <select
            className={selectClass}
            aria-label={t(
              lang,
              "Filter by location",
              "Filtrar por ubicación",
              "Nach Standort filtern"
            )}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">
              {t(
                lang,
                "All locations",
                "Todas las ubicaciones",
                "Alle Standorte"
              )}
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            aria-label={t(
              lang,
              "Filter by type",
              "Filtrar por tipo",
              "Nach Art filtern"
            )}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">
              {t(lang, "All types", "Todos los tipos", "Alle Arten")}
            </option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {reports.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t(
              lang,
              "There are no reports yet.",
              "Aún no hay reportes.",
              "Es gibt noch keine Meldungen."
            )}
          </p>
        )}
        {reports.map((r) => (
          <div key={r.id} className="space-y-2 border-b pb-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString(locale)}
              </span>
              <span className="font-medium">{r.staff_name}</span>
              <span className="text-muted-foreground">· {r.location_name}</span>
              {r.channel === "app" && <Badge variant="outline">App</Badge>}
              {canManage ? (
                <select
                  className={selectClass}
                  aria-label={t(
                    lang,
                    "Report type",
                    "Tipo de reporte",
                    "Art der Meldung"
                  )}
                  value={r.report_type}
                  onChange={(e) => reclassify(r.id, e.target.value)}
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge variant="secondary">
                  {TYPE_LABELS[r.report_type] ?? r.report_type}
                </Badge>
              )}
            </div>
            {r.text && <p>{r.text}</p>}
            {r.media_kind === "photo" && (
              <a
                href={`/api/restaurant/kitchen/reports/${r.id}/media`}
                target="_blank"
                rel="noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/restaurant/kitchen/reports/${r.id}/media`}
                  alt={t(
                    lang,
                    "Kitchen photo",
                    "Foto de la cocina",
                    "Foto aus der Küche"
                  )}
                  className="h-24 rounded-md border object-cover"
                  loading="lazy"
                />
              </a>
            )}
            {r.media_kind === "voice" && (
              <audio
                controls
                preload="none"
                src={`/api/restaurant/kitchen/reports/${r.id}/media`}
              />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
