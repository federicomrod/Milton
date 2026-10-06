"use client";

// components/restaurant/kitchen/KitchenReportsCard.tsx
//
// Newest 50 cook reports, filterable by location and type. Photos and
// voice notes load through the company-checked media proxy
// (/api/restaurant/kitchen/reports/[id]/media). Owners and Milton admins
// can reclassify a report (PATCH). No push notifications, no AI.

import { useEffect, useState } from "react";
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
  created_at: string;
  staff_name: string;
  location_name: string;
}

const TYPE_LABELS: Record<string, string> = {
  running_out: "Running out",
  "86": "86'd",
  waste: "Waste",
  unclassified: "Unclassified",
};

const selectClass =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

export function KitchenReportsCard({
  canManage,
  locations,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [locationId, setLocationId] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      if (locationId) params.set("location_id", locationId);
      if (type) params.set("type", type);
      const res = await fetch(`/api/restaurant/kitchen/reports?${params}`);
      if (cancelled) return;
      if (!res.ok) {
        setError("Could not load reports.");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setError(null);
      setReports(data.reports ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, type, reloadKey]);

  const reclassify = async (id: string, report_type: string) => {
    const res = await fetch(`/api/restaurant/kitchen/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_type }),
    });
    if (!res.ok) setError("Could not update the report.");
    setReloadKey((k) => k + 1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reports</CardTitle>
        <CardDescription>
          Items running out, 86&apos;d items and waste reported by your cooks.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <select
            className={selectClass}
            aria-label="Filter by location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            aria-label="Filter by type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All types</option>
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
          <p className="text-sm text-muted-foreground">No reports yet.</p>
        )}
        {reports.map((r) => (
          <div key={r.id} className="space-y-2 border-b pb-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </span>
              <span className="font-medium">{r.staff_name}</span>
              <span className="text-muted-foreground">· {r.location_name}</span>
              {canManage ? (
                <select
                  className={selectClass}
                  aria-label="Report type"
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
                  alt="Photo from the kitchen"
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
