// components/restaurant/shell/NotAvailableYet.tsx
//
// Explicit empty state for operating pages. Never a bare dash: title,
// short reason, optional link.

import Link from "next/link";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { getDictionary } from "@/lib/i18n";

export function NotAvailableYet({
  lang = "es",
  title,
  reason,
  href,
  linkLabel,
  compact = false,
}: {
  lang?: PreferredLanguage;
  title?: string;
  reason: string;
  href?: string;
  linkLabel?: string;
  /** Tight cell for the KPI strip — same copy, final slot size. */
  compact?: boolean;
}) {
  const d = getDictionary(lang).shell.notAvailable;
  const heading = title ?? d.title;
  const fallbackLink = d.addCosts;

  return (
    <div
      data-testid="not-available-yet"
      className={
        compact
          ? "rounded-md border border-dashed border-border bg-muted/20 px-2.5 py-1.5 min-h-[4.5rem]"
          : "rounded-md border border-dashed border-border bg-muted/20 px-4 py-4"
      }
    >
      <p
        className={compact ? "text-[12px] font-medium" : "text-sm font-medium"}
      >
        {heading}
      </p>
      <p
        className={
          compact
            ? "text-[12px] text-muted-foreground mt-0.5 leading-snug"
            : "text-sm text-muted-foreground mt-1"
        }
      >
        {reason}
      </p>
      {href ? (
        <Link
          href={href}
          className={
            compact
              ? "inline-block mt-0.5 text-[12px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] rounded-sm"
              : "inline-block mt-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] rounded-sm"
          }
        >
          {linkLabel ?? fallbackLink}
        </Link>
      ) : null}
    </div>
  );
}
