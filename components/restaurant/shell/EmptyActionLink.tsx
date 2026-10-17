"use client";

// A link in an empty state. «Subir archivo de costos» is a link to the cost
// file card on Costos: when we are already on that page it opens the file
// picker in the same click instead of a hash link that does nothing.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OPEN_COSTS_PICKER_EVENT } from "@/lib/restaurant/costs-picker";

export function EmptyActionLink({
  href,
  className,
  opensCostsPicker = false,
  children,
}: {
  href: string;
  className: string;
  /** Costos only: open the cost-file picker here when the page is already open. */
  opensCostsPicker?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (!opensCostsPicker || pathname !== href.split("#")[0]) return;
        const detail = { handled: false };
        window.dispatchEvent(
          new CustomEvent(OPEN_COSTS_PICKER_EVENT, { detail })
        );
        if (detail.handled) event.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}
