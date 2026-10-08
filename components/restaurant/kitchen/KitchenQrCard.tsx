"use client";

// components/restaurant/kitchen/KitchenQrCard.tsx
//
// "Wall QR per location": status per location plus, for owners and Milton
// admins, create / rotate. Rotating revokes the old sheet immediately
// (confirm dialog). Members see status only.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KitchenQrResult, type KitchenQrPayload } from "./KitchenQrResult";

interface LocationStatus {
  location_id: string;
  name: string;
  has_active_qr: boolean;
  qr_created_at: string | null;
  active_staff_count: number;
}

export function KitchenQrCard({ canManage }: { canManage: boolean }) {
  const [locations, setLocations] = useState<LocationStatus[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<LocationStatus | null>(null);
  const [created, setCreated] = useState<{
    qr: KitchenQrPayload;
    name: string;
  } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/restaurant/kitchen/qr");
      if (cancelled) return;
      if (!res.ok) {
        setError("Could not load QR status.");
        return;
      }
      const data = await res.json();
      if (!cancelled) setLocations(data.locations ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const createOrRotate = async (loc: LocationStatus) => {
    setBusyId(loc.location_id);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/restaurant/kitchen/qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_id: loc.location_id }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? "Only owners can create or rotate QRs."
            : "Could not create the QR."
        );
      } else {
        setCreated({ qr: await res.json(), name: loc.name });
        setReloadKey((k) => k + 1);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wall QR per location</CardTitle>
        <CardDescription>
          Cooks scan the QR on the wall to join their location on Telegram. No
          Milton account needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {locations.length === 0 && (
          <p className="text-sm text-muted-foreground">No locations yet.</p>
        )}
        {locations.map((loc) => (
          <div
            key={loc.location_id}
            className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm"
          >
            <div>
              <div className="font-medium">{loc.name}</div>
              <div className="text-xs text-muted-foreground">
                {loc.has_active_qr
                  ? `Active QR since ${new Date(loc.qr_created_at ?? "").toLocaleDateString()}`
                  : "No QR yet"}{" "}
                · {loc.active_staff_count} active cook
                {loc.active_staff_count === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={loc.has_active_qr ? "default" : "secondary"}>
                {loc.has_active_qr ? "QR active" : "No QR"}
              </Badge>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === loc.location_id}
                  onClick={() =>
                    loc.has_active_qr
                      ? setConfirmFor(loc)
                      : void createOrRotate(loc)
                  }
                >
                  {loc.has_active_qr
                    ? "Rotate QR (old sheet stops working)"
                    : "Create QR"}
                </Button>
              )}
            </div>
          </div>
        ))}
        {created && (
          <KitchenQrResult qr={created.qr} locationName={created.name} />
        )}
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            Only restaurant owners can create or rotate QRs.
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmFor !== null}
        onOpenChange={(o) => !o && setConfirmFor(null)}
        title="Rotate this QR?"
        description="The printed sheet stops working immediately. Cooks who already joined stay joined. You'll get a new QR to print."
        confirmText="Rotate QR"
        variant="destructive"
        onConfirm={() => confirmFor && void createOrRotate(confirmFor)}
      />
    </Card>
  );
}
