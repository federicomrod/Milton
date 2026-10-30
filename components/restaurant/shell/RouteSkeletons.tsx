// components/restaurant/shell/RouteSkeletons.tsx
//
// The skeletons the route-level loading.tsx files share. They occupy the final
// slot sizes of the page they stand in for (same container classes as the
// page), so nothing jumps when the real content streams in.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

/** Header + a row of stat cards + content blocks: the standard restaurant page. */
export function ListPageSkeleton({
  narrow = false,
  cards = 4,
  blocks = 2,
}: {
  narrow?: boolean;
  cards?: number;
  blocks?: number;
}) {
  return (
    <div
      className={
        "w-full space-y-3 px-[26px] pb-10 pt-4" + (narrow ? " max-w-3xl" : "")
      }
      data-testid="route-skeleton"
    >
      <PageSkeleton height="2.5rem" width="14rem" label="header" />
      {cards > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: cards }, (_, i) => (
            <PageSkeleton key={i} height="6rem" width="100%" label="card" />
          ))}
        </div>
      ) : null}
      {Array.from({ length: blocks }, (_, i) => (
        <PageSkeleton key={i} height="14rem" width="100%" label="content" />
      ))}
    </div>
  );
}

/** Rentabilidad: header, controls, four stat cards, the race chart, the tables. */
export function RentabilidadSkeleton() {
  return (
    <div
      className="w-full space-y-3 px-6 py-3 lg:px-10"
      data-testid="route-skeleton"
    >
      <PageSkeleton height="2.5rem" width="14rem" label="header" />
      <PageSkeleton height="2.25rem" width="100%" label="controls" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <PageSkeleton key={i} height="6.5rem" width="100%" label="card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PageSkeleton height="17rem" width="100%" label="chart" />
        </div>
        <PageSkeleton height="17rem" width="100%" label="resumen" />
      </div>
      <PageSkeleton height="14rem" width="100%" label="tabla" />
    </div>
  );
}
