"use client";

// components/restaurant/kitchen/KitchenQrResult.tsx
//
// Shows a freshly created/rotated kitchen QR ONCE, with Download PNG /
// Download SVG / Copy link. Storage is hash-only, so this QR can never be
// shown again — the copy says so. Shared by the manager card and the
// Milton admin page.

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface KitchenQrPayload {
  deep_link: string;
  qr_svg: string;
  qr_png_data_url: string;
}

export function downloadQrFile(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

export function kitchenQrFilename(locationName: string): string {
  return `milton-kitchen-qr-${locationName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

export async function shareOrDownloadQr(
  qr: KitchenQrPayload,
  locationName: string,
  lang: PreferredLanguage = "es"
) {
  const shareTitle = t(lang, "Kitchen QR", "QR de cocina", "Küchen-QR-Code");
  const base = kitchenQrFilename(locationName);
  const filename = `${base}.png`;
  try {
    const res = await fetch(qr.qr_png_data_url);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: "image/png" });
    const canFiles =
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] });
    if (typeof navigator.share === "function" && canFiles) {
      await navigator.share({
        files: [file],
        title: shareTitle,
      });
      return;
    }
    if (typeof navigator.share === "function") {
      await navigator.share({
        title: shareTitle,
        url: qr.deep_link,
      });
      return;
    }
  } catch {
    // fall through to download
  }
  downloadQrFile(qr.qr_png_data_url, filename);
}

export function KitchenQrResult({
  qr,
  locationName,
  variant = "full",
}: {
  qr: KitchenQrPayload;
  locationName: string;
  variant?: "full" | "print";
}) {
  const { lang } = useT();
  const qrAlt = t(
    lang,
    `Kitchen QR code of ${locationName}`,
    `QR de cocina para ${locationName}`,
    `Küchen-QR-Code für ${locationName}`
  );
  const [copied, setCopied] = useState(false);
  const base = kitchenQrFilename(locationName);
  const sizeClass = variant === "print" ? "h-[180px] w-[180px]" : "h-48 w-48";

  const downloadSvg = () => {
    const url = URL.createObjectURL(
      new Blob([qr.qr_svg], { type: "image/svg+xml" })
    );
    downloadQrFile(url, `${base}.svg`);
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(qr.deep_link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (variant === "print") {
    return (
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr.qr_png_data_url}
          alt={qrAlt}
          data-testid="kitchen-qr"
          className={`${sizeClass} mx-auto`}
        />
        <Button
          type="button"
          className="w-full bg-[#1B40C8] text-white hover:bg-[#1533A3]"
          onClick={() => downloadQrFile(qr.qr_png_data_url, `${base}.png`)}
        >
          {t(
            lang,
            "Download QR to print",
            "Descargar QR para imprimir",
            "QR-Code zum Drucken herunterladen"
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="font-medium">
        {t(
          lang,
          `QR of ${locationName}`,
          `QR de ${locationName}`,
          `QR-Code von ${locationName}`
        )}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qr.qr_png_data_url}
        alt={qrAlt}
        data-testid="kitchen-qr"
        className={sizeClass}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadQrFile(qr.qr_png_data_url, `${base}.png`)}
        >
          {t(lang, "Download PNG", "Descargar PNG", "PNG herunterladen")}
        </Button>
        <Button size="sm" variant="outline" onClick={downloadSvg}>
          {t(lang, "Download SVG", "Descargar SVG", "SVG herunterladen")}
        </Button>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied
            ? t(lang, "Copied", "Copiado", "Kopiert")
            : t(lang, "Copy link", "Copiar enlace", "Link kopieren")}
        </Button>
      </div>
      <Alert>
        <AlertDescription>
          {t(
            lang,
            "We cannot show this QR again. If the sheet is lost, rotate it.",
            "No podemos volver a mostrar este QR. Si se pierde la hoja, rótalo.",
            "Dieser QR-Code kann nicht erneut angezeigt werden. Geht das Blatt verloren, erneuern Sie ihn."
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}
