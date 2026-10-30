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
import { useT } from "@/lib/i18n/client";
import { t } from "@/lib/restaurant/language";
import { KitchenQrResult, type KitchenQrPayload } from "./KitchenQrResult";

interface LocationStatus {
  location_id: string;
  name: string;
  has_active_qr: boolean;
  qr_created_at: string | null;
  active_staff_count: number;
}

export function KitchenQrCard({ canManage }: { canManage: boolean }) {
  const { lang, locale } = useT();
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
        setError(
          t(
            lang,
            "Could not load the QR status.",
            "No se pudo cargar el estado del QR.",
            "Der QR-Status konnte nicht geladen werden."
          )
        );
        return;
      }
      const data = await res.json();
      if (!cancelled) setLocations(data.locations ?? []);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            ? t(
                lang,
                "Only owners can create or rotate QR codes.",
                "Solo los dueños pueden crear o rotar QRs.",
                "Nur Inhaber können QR-Codes erstellen oder erneuern."
              )
            : t(
                lang,
                "Could not create the QR.",
                "No se pudo crear el QR.",
                "Der QR-Code konnte nicht erstellt werden."
              )
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
        <CardTitle>
          {t(
            lang,
            "Wall QR per location",
            "QR de pared por ubicación",
            "Wand-QR-Code pro Standort"
          )}
        </CardTitle>
        <CardDescription>
          {t(
            lang,
            "Your cooks scan the wall QR to join their location. They do not need a Milton account.",
            "Tus cocineros escanean el QR de la pared para unirse a su ubicación. No necesitan una cuenta de Milton.",
            "Ihre Köche scannen den QR-Code an der Wand, um ihrem Standort beizutreten. Sie benötigen kein Milton-Konto."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {locations.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t(
              lang,
              "There are no locations yet.",
              "Aún no hay ubicaciones.",
              "Es gibt noch keine Standorte."
            )}
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
                  ? t(
                      lang,
                      `Since ${new Date(loc.qr_created_at ?? "").toLocaleDateString(locale)} · `,
                      `Desde ${new Date(loc.qr_created_at ?? "").toLocaleDateString(locale)} · `,
                      `Seit ${new Date(loc.qr_created_at ?? "").toLocaleDateString(locale)} · `
                    )
                  : ""}
                {loc.active_staff_count}{" "}
                {loc.active_staff_count === 1
                  ? t(lang, "active cook", "cocinero activo", "aktiver Koch")
                  : t(
                      lang,
                      "active cooks",
                      "cocineros activos",
                      "aktive Köche"
                    )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={loc.has_active_qr ? "default" : "secondary"}>
                {loc.has_active_qr
                  ? t(lang, "QR active", "QR activo", "QR-Code aktiv")
                  : t(lang, "No QR", "Sin QR", "Kein QR-Code")}
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
                    ? t(lang, "Rotate QR", "Rotar QR", "QR-Code erneuern")
                    : t(lang, "Create QR", "Crear QR", "QR-Code erstellen")}
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
            {t(
              lang,
              "Only restaurant owners can create or rotate QR codes.",
              "Solo los dueños del restaurante pueden crear o rotar QRs.",
              "Nur Restaurantinhaber können QR-Codes erstellen oder erneuern."
            )}
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmFor !== null}
        onOpenChange={(o) => !o && setConfirmFor(null)}
        title={t(
          lang,
          "Rotate this QR?",
          "¿Rotar este QR?",
          "Diesen QR-Code erneuern?"
        )}
        description={t(
          lang,
          "The printed sheet stops working immediately. Cooks who already joined stay. You will get a new QR to print.",
          "La hoja impresa deja de servir de inmediato. Los cocineros que ya se unieron se quedan. Vas a recibir un QR nuevo para imprimir.",
          "Das gedruckte Blatt funktioniert sofort nicht mehr. Bereits beigetretene Köche bleiben. Sie erhalten einen neuen QR-Code zum Drucken."
        )}
        confirmText={t(lang, "Rotate QR", "Rotar QR", "QR-Code erneuern")}
        variant="destructive"
        onConfirm={() => confirmFor && void createOrRotate(confirmFor)}
      />
    </Card>
  );
}
