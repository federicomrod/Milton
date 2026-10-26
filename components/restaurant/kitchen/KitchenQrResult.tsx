"use client";

// components/restaurant/kitchen/KitchenQrResult.tsx
//
// Shows a freshly created/rotated kitchen QR ONCE, with Download PNG /
// Download SVG / Copy link. Storage is hash-only, so this QR can never be
// shown again — the copy says so. Shared by the manager card and the
// Milton admin page.

import { useState } from "react";
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
  locationName: string
) {
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
        title: "QR de cocina",
      });
      return;
    }
    if (typeof navigator.share === "function") {
      await navigator.share({
        title: "QR de cocina",
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
          alt={`QR de cocina para ${locationName}`}
          data-testid="kitchen-qr"
          className={`${sizeClass} mx-auto`}
        />
        <Button
          type="button"
          className="w-full bg-[#1B40C8] text-white hover:bg-[#1533A3]"
          onClick={() => downloadQrFile(qr.qr_png_data_url, `${base}.png`)}
        >
          Descargar QR para imprimir
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="font-medium">QR for {locationName}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qr.qr_png_data_url}
        alt={`QR de cocina para ${locationName}`}
        data-testid="kitchen-qr"
        className={sizeClass}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadQrFile(qr.qr_png_data_url, `${base}.png`)}
        >
          Descargar PNG
        </Button>
        <Button size="sm" variant="outline" onClick={downloadSvg}>
          Descargar SVG
        </Button>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Copiado" : "Copiar enlace"}
        </Button>
      </div>
      <Alert>
        <AlertDescription>
          No podemos volver a mostrar este QR. Si se pierde la hoja, rótalo.
        </AlertDescription>
      </Alert>
    </div>
  );
}
