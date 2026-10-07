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

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

export function KitchenQrResult({
  qr,
  locationName,
}: {
  qr: KitchenQrPayload;
  locationName: string;
}) {
  const [copied, setCopied] = useState(false);
  const base = `milton-kitchen-qr-${locationName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  const downloadSvg = () => {
    const url = URL.createObjectURL(
      new Blob([qr.qr_svg], { type: "image/svg+xml" })
    );
    download(url, `${base}.svg`);
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

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="font-medium">QR for {locationName}</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qr.qr_png_data_url}
        alt={`Kitchen QR for ${locationName}`}
        className="h-48 w-48"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => download(qr.qr_png_data_url, `${base}.png`)}
        >
          Download PNG
        </Button>
        <Button size="sm" variant="outline" onClick={downloadSvg}>
          Download SVG
        </Button>
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <Alert>
        <AlertDescription>
          We can&apos;t show this QR again. If the sheet is lost, rotate.
        </AlertDescription>
      </Alert>
    </div>
  );
}
