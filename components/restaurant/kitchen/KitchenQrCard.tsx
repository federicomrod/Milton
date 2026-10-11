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
        setError("No se pudo cargar el estado del QR.");
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
            ? "Solo los dueños pueden crear o rotar QRs."
            : "No se pudo crear el QR."
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
        <CardTitle>QR de pared por ubicación</CardTitle>
        <CardDescription>
          Tus cocineros escanean el QR de la pared para unirse a su ubicación en
          Telegram. No necesitan una cuenta de Milton.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {locations.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Aún no hay ubicaciones.
          </p>
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
                  ? `QR activo desde ${new Date(loc.qr_created_at ?? "").toLocaleDateString("es-MX")}`
                  : "Aún no hay QR"}{" "}
                · {loc.active_staff_count}{" "}
                {loc.active_staff_count === 1
                  ? "cocinero activo"
                  : "cocineros activos"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={loc.has_active_qr ? "default" : "secondary"}>
                {loc.has_active_qr ? "QR activo" : "Sin QR"}
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
                    ? "Rotar QR (la hoja vieja deja de servir)"
                    : "Crear QR"}
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
            Solo los dueños del restaurante pueden crear o rotar QRs.
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmFor !== null}
        onOpenChange={(o) => !o && setConfirmFor(null)}
        title="¿Rotar este QR?"
        description="La hoja impresa deja de servir de inmediato. Los cocineros que ya se unieron se quedan. Vas a recibir un QR nuevo para imprimir."
        confirmText="Rotar QR"
        variant="destructive"
        onConfirm={() => confirmFor && void createOrRotate(confirmFor)}
      />
    </Card>
  );
}
