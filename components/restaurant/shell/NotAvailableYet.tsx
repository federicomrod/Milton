// components/restaurant/shell/NotAvailableYet.tsx
//
// Explicit empty state for operating pages. Never a bare dash: title,
// short reason, optional link.

import Link from "next/link";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

export function NotAvailableYet({
  lang = "en",
  title,
  reason,
  href,
  linkLabel,
}: {
  lang?: PreferredLanguage;
  title?: string;
  reason: string;
  href?: string;
  linkLabel?: string;
}) {
  const heading = title ?? t(lang, "Not available yet", "Aún no disponible");
  const fallbackLink = t(lang, "Add costs →", "Agregar costos →");

  return (
    <div
      data-testid="not-available-yet"
      className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-4"
    >
      <p className="text-sm font-medium">{heading}</p>
      <p className="text-sm text-muted-foreground mt-1">{reason}</p>
      {href ? (
        <Link
          href={href}
          className="inline-block mt-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm"
        >
          {linkLabel ?? fallbackLink}
        </Link>
      ) : null}
    </div>
  );
}
