"use client";

// components/restaurant/kitchen/KitchenConnectCard.tsx
//
// Right-column / stacked «Conecta tu cocina» (unlinked) and compact
// «Equipo de cocina» (linked). Reuses the existing QR create endpoint and
// KitchenQrResult / KitchenStaffCard / KitchenQrCard.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cookInitials } from "@/lib/restaurant/kitchen-draft-source";
import { KitchenQrCard } from "./KitchenQrCard";
import {
  KitchenQrResult,
  downloadQrFile,
  kitchenQrFilename,
  shareOrDownloadQr,
  type KitchenQrPayload,
} from "./KitchenQrResult";
import { KitchenStaffCard } from "./KitchenStaffCard";

interface LocationStatus {
  location_id: string;
  name: string;
  has_active_qr: boolean;
  qr_created_at: string | null;
  active_staff_count: number;
}

function cacheKey(locationId: string) {
  return `milton:kitchen-qr:${locationId}`;
}

function readCachedQr(locationId: string): KitchenQrPayload | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(locationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KitchenQrPayload;
    if (
      typeof parsed.deep_link === "string" &&
      typeof parsed.qr_png_data_url === "string" &&
      typeof parsed.qr_svg === "string"
    ) {
      return parsed;
    }
  } catch {
    // private mode / blocked storage
  }
  return null;
}

function writeCachedQr(locationId: string, qr: KitchenQrPayload) {
  try {
    sessionStorage.setItem(cacheKey(locationId), JSON.stringify(qr));
  } catch {
    // ignore
  }
}

type QrLoad = {
  qr: KitchenQrPayload | null;
  locationName: string;
  error: string | null;
};

let qrLoad: Promise<QrLoad> | null = null;

export function resetKitchenQrLoad() {
  qrLoad = null;
}

async function loadConnectQr(
  canManage: boolean,
  fallbackName: string
): Promise<QrLoad> {
  if (qrLoad) return qrLoad;
  qrLoad = (async () => {
    const res = await fetch("/api/restaurant/kitchen/qr");
    if (!res.ok) {
      return {
        qr: null,
        locationName: fallbackName,
        error: "No se pudo cargar el QR de cocina.",
      };
    }
    const data = (await res.json()) as { locations?: LocationStatus[] };
    const loc = data.locations?.[0];
    if (!loc) {
      return { qr: null, locationName: fallbackName, error: null };
    }
    const cached = readCachedQr(loc.location_id);
    if (cached) {
      return { qr: cached, locationName: loc.name, error: null };
    }
    if (loc.has_active_qr || !canManage) {
      return { qr: null, locationName: loc.name, error: null };
    }
    const created = await fetch("/api/restaurant/kitchen/qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location_id: loc.location_id }),
    });
    if (!created.ok) {
      return {
        qr: null,
        locationName: loc.name,
        error:
          created.status === 403
            ? "Solo los dueños pueden crear el QR."
            : "No se pudo crear el QR.",
      };
    }
    const payload = (await created.json()) as KitchenQrPayload;
    writeCachedQr(loc.location_id, payload);
    return { qr: payload, locationName: loc.name, error: null };
  })();
  return qrLoad;
}

export function KitchenConnectCard({
  canManage,
  locations,
  linkedCooks,
  variant,
}: {
  canManage: boolean;
  locations: { id: string; name: string }[];
  linkedCooks: { id: string; name: string }[];
  variant: "full" | "compact";
}) {
  const [qr, setQr] = useState<KitchenQrPayload | null>(null);
  const [locationName, setLocationName] = useState(
    locations[0]?.name ?? "cocina"
  );
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadConnectQr(canManage, locations[0]?.name ?? "cocina").then(
      (next) => {
        if (cancelled) return;
        setQr(next.qr);
        setLocationName(next.locationName);
        setError(next.error);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [canManage, locations]);

  const qrBlock = qr ? (
    <KitchenQrResult qr={qr} locationName={locationName} variant="print" />
  ) : null;

  if (variant === "compact") {
    return (
      <section
        id="equipo"
        data-testid="kitchen-connect-compact"
        className="rounded-md border border-border bg-background px-3 py-3 space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#0D1117]">
            Equipo de cocina{" "}
            <span className="font-normal text-[#1B40C8]">
              · {linkedCooks.length}{" "}
              {linkedCooks.length === 1 ? "conectado" : "conectados"}
            </span>
          </h2>
          <button
            type="button"
            className="text-xs font-semibold text-[#1B40C8] hover:text-[#1533A3] underline-offset-2 hover:underline"
            onClick={() => setShowTeam(true)}
          >
            Ver equipo
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {linkedCooks.slice(0, 6).map((cook) => (
            <span
              key={cook.id}
              title={cook.name}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#E8EEFB] text-[11px] font-semibold text-[#1B40C8]"
            >
              {cookInitials(cook.name)}
            </span>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowQr(true)}
          >
            Mostrar QR
          </Button>
        </div>
        <Dialog open={showQr} onOpenChange={setShowQr}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Conecta tu cocina</DialogTitle>
              <DialogDescription>
                Tu equipo escanea este código con Telegram y ya puede mandarte
                reportes y recetas por nota de voz.
              </DialogDescription>
            </DialogHeader>
            {qrBlock}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogContent>
        </Dialog>
        <Dialog open={showTeam} onOpenChange={setShowTeam}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Equipo de cocina</DialogTitle>
              <DialogDescription>
                Personal de cocina que se unió escaneando un QR.
              </DialogDescription>
            </DialogHeader>
            <KitchenStaffCard canManage={canManage} locations={locations} />
            <KitchenQrCard canManage={canManage} />
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  return (
    <section
      id="equipo"
      data-testid="kitchen-connect"
      className="rounded-md border border-border bg-background px-3 py-3 space-y-3"
    >
      <h2 className="text-sm font-semibold text-[#0D1117]">
        Conecta tu cocina
      </h2>
      {qr ? (
        <div className="mx-auto w-[180px] max-md:w-[200px] max-md:[&_img]:h-[200px] max-md:[&_img]:w-[200px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr.qr_png_data_url}
            alt={`QR de cocina para ${locationName}`}
            data-testid="kitchen-qr"
            className="h-[180px] w-[180px] max-md:h-[200px] max-md:w-[200px]"
          />
        </div>
      ) : (
        <div
          data-testid="kitchen-qr-slot"
          className="mx-auto h-[180px] w-[180px] max-md:h-[200px] max-md:w-[200px] rounded-md border border-dashed border-border"
        />
      )}
      <p className="text-sm text-[#0D1117]">
        Tu equipo escanea este código con Telegram y ya puede mandarte reportes
        y recetas por nota de voz.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="hidden md:block space-y-1">
        <Button
          type="button"
          disabled={!qr}
          className="w-full bg-[#1B40C8] text-white hover:bg-[#1533A3] disabled:opacity-60"
          onClick={() =>
            qr &&
            downloadQrFile(
              qr.qr_png_data_url,
              `${kitchenQrFilename(locationName)}.png`
            )
          }
        >
          Descargar QR para imprimir
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          Pégalo en la cocina.
        </p>
      </div>
      <div className="md:hidden">
        <Button
          type="button"
          disabled={!qr}
          className="w-full bg-[#1B40C8] text-white hover:bg-[#1533A3] disabled:opacity-60"
          onClick={() => qr && void shareOrDownloadQr(qr, locationName)}
        >
          Compartir QR
        </Button>
      </div>
    </section>
  );
}
