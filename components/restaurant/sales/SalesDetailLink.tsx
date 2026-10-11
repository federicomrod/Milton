// components/restaurant/sales/SalesDetailLink.tsx
//
// One-level-deeper link into Investigate. No KPI math.

import Link from "next/link";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";

export function SalesDetailLink({
  href,
  lang,
  label,
}: {
  href: string;
  lang: PreferredLanguage;
  label?: string;
}) {
  return (
    <Link
      href={href}
      data-testid="sales-detail-link"
      className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
    >
      {label ?? t(lang, "See details", "Ver detalles")}
    </Link>
  );
}
