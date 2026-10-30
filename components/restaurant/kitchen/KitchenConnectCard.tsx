"use client";

// components/restaurant/kitchen/KitchenConnectCard.tsx
//
// Right-column / stacked «Conecta tu cocina» (unlinked) and compact
// «Equipo de cocina» (linked). Reuses the existing QR create endpoint and
// KitchenQrResult / KitchenStaffCard / KitchenQrCard.

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
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
    // private window / blocked storage
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
  locationId: string | null;
  hasActiveQr: boolean;
  error: string | null;
};

let qrLoad: Promise<QrLoad> | null = null;

export function resetKitchenQrLoad() {
  qrLoad = null;
}

const loadFailedText = (lang: PreferredLanguage) =>
  t(
    lang,
    "Could not load the kitchen QR.",
    "No se pudo cargar el QR de cocina.",
    "Der Küchen-QR-Code konnte nicht geladen werden."
  );
const ownersOnlyText = (lang: PreferredLanguage) =>
  t(
    lang,
    "Only owners can create the QR.",
    "Solo los dueños pueden crear el QR.",
    "Nur Inhaber können den QR-Code erstellen."
  );
const createFailedText = (lang: PreferredLanguage) =>
  t(
    lang,
    "Could not create the QR.",
    "No se pudo crear el QR.",
    "Der QR-Code konnte nicht erstellt werden."
  );

function emptyLoad(
  over: Partial<QrLoad> & Pick<QrLoad, "locationName">
): QrLoad {
  return {
    qr: null,
    locationId: null,
    hasActiveQr: false,
    error: null,
    ...over,
  };
}

async function loadConnectQr(
  canManage: boolean,
  fallbackName: string,
  lang: PreferredLanguage
): Promise<QrLoad> {
  if (qrLoad) return qrLoad;
  const pending = (async (): Promise<QrLoad> => {
    const res = await fetch("/api/restaurant/kitchen/qr");
    if (!res.ok) {
      return emptyLoad({
        locationName: fallbackName,
        error: loadFailedText(lang),
      });
    }
    const data = (await res.json()) as { locations?: LocationStatus[] };
    const loc = data.locations?.[0];
    if (!loc) {
      return emptyLoad({ locationName: fallbackName });
    }
    const cached = readCachedQr(loc.location_id);
    if (cached) {
      return {
        qr: cached,
        locationName: loc.name,
        locationId: loc.location_id,
        hasActiveQr: true,
        error: null,
      };
    }
    if (loc.has_active_qr || !canManage) {
      return {
        qr: null,
        locationName: loc.name,
        locationId: loc.location_id,
        hasActiveQr: loc.has_active_qr,
        error: null,
      };
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
        locationId: loc.location_id,
        hasActiveQr: false,
        error:
          created.status === 403
            ? ownersOnlyText(lang)
            : createFailedText(lang),
      };
    }
    const payload = (await created.json()) as KitchenQrPayload;
    writeCachedQr(loc.location_id, payload);
    return {
      qr: payload,
      locationName: loc.name,
      locationId: loc.location_id,
      hasActiveQr: true,
      error: null,
    };
  })();
  qrLoad = pending;
  try {
    const result = await pending;
    if (result.error) qrLoad = null;
    return result;
  } catch (err) {
    qrLoad = null;
    throw err;
  }
}

async function rotateConnectQr(
  locationId: string,
  locationName: string,
  lang: PreferredLanguage
): Promise<QrLoad> {
  qrLoad = null;
  const created = await fetch("/api/restaurant/kitchen/qr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location_id: locationId }),
  });
  if (!created.ok) {
    return {
      qr: null,
      locationName,
      locationId,
      hasActiveQr: true,
      error:
        created.status === 403 ? ownersOnlyText(lang) : createFailedText(lang),
    };
  }
  const payload = (await created.json()) as KitchenQrPayload;
  writeCachedQr(locationId, payload);
  const next: QrLoad = {
    qr: payload,
    locationName,
    locationId,
    hasActiveQr: true,
    error: null,
  };
  qrLoad = Promise.resolve(next);
  return next;
}

function QrMissing({
  lang,
  canManage,
  locationId,
  hasActiveQr,
  busy,
  onGenerate,
}: {
  lang: PreferredLanguage;
  canManage: boolean;
  locationId: string | null;
  hasActiveQr: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  if (canManage) {
    return (
      <div className="space-y-2" data-testid="kitchen-qr-generate">
        <Button
          type="button"
          disabled={busy || !locationId}
          className="w-full bg-[#1B40C8] text-white hover:bg-[#1533A3] disabled:opacity-60"
          onClick={onGenerate}
        >
          {t(
            lang,
            "Generate new QR",
            "Generar QR nuevo",
            "Neuen QR-Code erzeugen"
          )}
        </Button>
        {hasActiveQr ? (
          <p className="text-center text-[12px] text-muted-foreground">
            {t(
              lang,
              "This replaces the previous QR.",
              "Esto reemplaza el QR anterior.",
              "Dies ersetzt den bisherigen QR-Code."
            )}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <p className="text-sm text-[#0D1117]" data-testid="kitchen-qr-ask-owner">
      {t(
        lang,
        "Ask the owner to share the QR with you.",
        "Pide al dueño que te comparta el QR.",
        "Bitten Sie den Inhaber, den QR-Code mit Ihnen zu teilen."
      )}
    </p>
  );
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
  const { lang, d } = useT();
  const kitchenWord = t(lang, "kitchen", "cocina", "Küche");
  const qrIntro = d.kitchen.qrIntro;
  const [qr, setQr] = useState<KitchenQrPayload | null>(null);
  const [locationName, setLocationName] = useState(
    locations[0]?.name ?? kitchenWord
  );
  const [locationId, setLocationId] = useState<string | null>(
    locations[0]?.id ?? null
  );
  const [hasActiveQr, setHasActiveQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showTeam, setShowTeam] = useState(false);

  const apply = (next: QrLoad) => {
    setQr(next.qr);
    setLocationName(next.locationName);
    setLocationId(next.locationId);
    setHasActiveQr(next.hasActiveQr);
    setError(next.error);
  };

  useEffect(() => {
    let cancelled = false;
    void loadConnectQr(canManage, locations[0]?.name ?? kitchenWord, lang)
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch(() => {
        if (!cancelled) {
          setError(loadFailedText(lang));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, locations, lang]);

  const generate = async () => {
    if (!locationId) return;
    setBusy(true);
    try {
      apply(await rotateConnectQr(locationId, locationName, lang));
    } finally {
      setBusy(false);
    }
  };

  const qrBlock = qr ? (
    <KitchenQrResult qr={qr} locationName={locationName} variant="print" />
  ) : (
    <QrMissing
      lang={lang}
      canManage={canManage}
      locationId={locationId}
      hasActiveQr={hasActiveQr}
      busy={busy}
      onGenerate={() => void generate()}
    />
  );

  if (variant === "compact") {
    return (
      <section
        id="equipo"
        data-testid="kitchen-connect-compact"
        className="rounded-md border border-border bg-background px-3 py-3 space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#0D1117]">
            {t(lang, "Kitchen team", "Equipo de cocina", "Küchenteam")}{" "}
            <span className="font-normal text-[#1B40C8]">
              · {linkedCooks.length}{" "}
              {linkedCooks.length === 1
                ? t(lang, "connected", "conectado", "verbunden")
                : t(lang, "connected", "conectados", "verbunden")}
            </span>
          </h2>
          <button
            type="button"
            className="text-xs font-semibold text-[#1B40C8] hover:text-[#1533A3] underline-offset-2 hover:underline"
            onClick={() => setShowTeam(true)}
          >
            {t(lang, "View team", "Ver equipo", "Team anzeigen")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {linkedCooks.slice(0, 6).map((cook) => (
            <span
              key={cook.id}
              title={cook.name}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#E7EDFD] text-[11px] font-semibold text-[#1B40C8]"
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
            {t(lang, "Show QR", "Mostrar QR", "QR-Code anzeigen")}
          </Button>
        </div>
        <Dialog open={showQr} onOpenChange={setShowQr}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {t(
                  lang,
                  "Connect your kitchen",
                  "Conecta tu cocina",
                  "Küche verbinden"
                )}
              </DialogTitle>
              {qr ? <DialogDescription>{qrIntro}</DialogDescription> : null}
            </DialogHeader>
            {qrBlock}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </DialogContent>
        </Dialog>
        <Dialog open={showTeam} onOpenChange={setShowTeam}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {t(lang, "Kitchen team", "Equipo de cocina", "Küchenteam")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t(lang, "Kitchen team", "Equipo de cocina", "Küchenteam")}
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
        {t(
          lang,
          "Connect your kitchen",
          "Conecta tu cocina",
          "Küche verbinden"
        )}
      </h2>
      {qr ? (
        <div className="mx-auto w-[180px] max-md:w-[200px] max-md:[&_img]:h-[200px] max-md:[&_img]:w-[200px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr.qr_png_data_url}
            alt={t(
              lang,
              `Kitchen QR code of ${locationName}`,
              `QR de cocina para ${locationName}`,
              `Küchen-QR-Code für ${locationName}`
            )}
            data-testid="kitchen-qr"
            className="h-[180px] w-[180px] max-md:h-[200px] max-md:w-[200px]"
          />
        </div>
      ) : null}
      {qr ? <p className="text-sm text-[#0D1117]">{qrIntro}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {qr ? (
        <>
          <div className="hidden md:block space-y-1">
            <Button
              type="button"
              className="w-full bg-[#1B40C8] text-white hover:bg-[#1533A3]"
              onClick={() =>
                downloadQrFile(
                  qr.qr_png_data_url,
                  `${kitchenQrFilename(locationName)}.png`
                )
              }
            >
              {t(
                lang,
                "Download QR to print",
                "Descargar QR para imprimir",
                "QR-Code zum Drucken herunterladen"
              )}
            </Button>
            <p className="text-center text-[12px] text-muted-foreground">
              {t(
                lang,
                "Stick it up in the kitchen.",
                "Pégalo en la cocina.",
                "Hängen Sie ihn in der Küche auf."
              )}
            </p>
          </div>
          <div className="md:hidden">
            <Button
              type="button"
              className="w-full bg-[#1B40C8] text-white hover:bg-[#1533A3]"
              onClick={() => void shareOrDownloadQr(qr, locationName, lang)}
            >
              {t(lang, "Share QR", "Compartir QR", "QR-Code teilen")}
            </Button>
          </div>
        </>
      ) : (
        <QrMissing
          lang={lang}
          canManage={canManage}
          locationId={locationId}
          hasActiveQr={hasActiveQr}
          busy={busy}
          onGenerate={() => void generate()}
        />
      )}
    </section>
  );
}
