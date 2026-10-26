// components/restaurant/costs/CostsPageLayout.tsx
//
// Two-column layout for the Costos page (desktop ≥1024px): the main column
// (~70-72% wide) holds the 4 KPIs and the tabs; the right column (300-320px,
// sticky) holds compact cards for Últimas facturas, Configura tus costos, and
// Último archivo. On tablet (768-1023px) the right column moves below the tabs
// as a row of 3 small cards. On mobile (<768px) everything stacks with a slim
// setup banner when incomplete.

import type { ReactNode } from "react";

export function CostsPageLayout({ children }: { children: ReactNode }) {
  return <div className="w-full px-[26px] pt-4 pb-10">{children}</div>;
}

export function CostsMainColumn({ children }: { children: ReactNode }) {
  return <div className="lg:flex-1 lg:min-w-0 space-y-5">{children}</div>;
}

export function CostsRightColumn({ children }: { children: ReactNode }) {
  return (
    <aside className="lg:w-[320px] lg:shrink-0 lg:sticky lg:top-[80px] lg:self-start space-y-3 max-lg:hidden">
      {children}
    </aside>
  );
}

export function CostsContentWrapper({ children }: { children: ReactNode }) {
  return <div className="lg:flex lg:gap-6">{children}</div>;
}
