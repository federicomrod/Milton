// components/restaurant/kitchen/KitchenPageLayout.tsx
//
// Desktop (≥1024): main ~70% + sticky 300–320px right column.
// Tablet / mobile stack in the main column; the aside is desktop-only.

import type { ReactNode } from "react";

export function KitchenPageLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="kitchen-page-layout"
      className="lg:flex lg:items-start lg:gap-6"
    >
      {children}
    </div>
  );
}

export function KitchenMainColumn({ children }: { children: ReactNode }) {
  return (
    <div data-testid="kitchen-main" className="min-w-0 flex-1 space-y-3">
      {children}
    </div>
  );
}

export function KitchenRightColumn({ children }: { children: ReactNode }) {
  return (
    <aside
      data-testid="kitchen-aside"
      className="hidden w-[300px] shrink-0 space-y-3 self-start lg:sticky lg:top-20 lg:block xl:w-[320px]"
    >
      {children}
    </aside>
  );
}
