"use client";

// app/management/kitchen/page.tsx
//
// Thin Milton-admin page: pick a company, then create or rotate a
// location's kitchen QR through /api/management/kitchen/qr (R1 #55). The QR
// is shown once; storage is hash-only, so a lost sheet means rotating.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  KitchenQrResult,
  type KitchenQrPayload,
} from "@/components/restaurant/kitchen/KitchenQrResult";

interface Company {
  id: string;
  name: string;
}
interface LocationStatus {
  location_id: string;
  name: string;
  has_active_qr: boolean;
  qr_created_at: string | null;
  active_staff_count: number;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm";

export default function ManagementKitchenPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [locations, setLocations] = useState<LocationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    qr: KitchenQrPayload;
    name: string;
  } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/management/kitchen/qr${companyId ? `?company_id=${companyId}` : ""}`
      );
      if (cancelled) return;
      if (!res.ok) {
        setError("Could not load.");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      setCompanies(data.companies ?? []);
      setLocations(data.locations ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, reloadKey]);

  const createOrRotate = async (loc: LocationStatus) => {
    if (
      loc.has_active_qr &&
      !window.confirm(
        "Rotate this QR? The printed sheet stops working immediately."
      )
    ) {
      return;
    }
    setBusy(loc.location_id);
    setError(null);
    const res = await fetch("/api/management/kitchen/qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        location_id: loc.location_id,
      }),
    });
    if (res.ok) {
      setCreated({ qr: await res.json(), name: loc.name });
      setReloadKey((k) => k + 1);
    } else {
      setError("Could not create the QR.");
    }
    setBusy(null);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Kitchen QR</h1>
        <p className="text-sm text-muted-foreground">
          Create or rotate a location&apos;s kitchen QR for any company.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Company</CardTitle>
          <CardDescription>
            A lost sheet can&apos;t be re-shown — rotate to issue a new one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <select
              id="company"
              className={selectClass}
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setCreated(null);
              }}
            >
              <option value="">Select a company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {locations.map((loc) => (
            <div
              key={loc.location_id}
              className="flex items-center justify-between gap-2 border-b py-2 text-sm"
            >
              <div>
                <div className="font-medium">{loc.name}</div>
                <div className="text-xs text-muted-foreground">
                  {loc.has_active_qr ? "QR active" : "No QR"} ·{" "}
                  {loc.active_staff_count} active cook
                  {loc.active_staff_count === 1 ? "" : "s"}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === loc.location_id}
                onClick={() => createOrRotate(loc)}
              >
                {loc.has_active_qr ? "Rotate QR" : "Create QR"}
              </Button>
            </div>
          ))}
          {created && (
            <KitchenQrResult qr={created.qr} locationName={created.name} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
