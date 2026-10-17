// app/dashboard/restaurant/sales/loading.tsx
//
// Skeleton of the Ventas layout: header, filter bar, five KPI cards, the
// «Lo que destaca» strip, and the chart + heatmap row.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function SalesLoading() {
  return (
    <div
      className="w-full px-6 py-3 lg:px-10 space-y-3"
      data-testid="sales-loading"
    >
      <PageSkeleton width="10rem" height="2.5rem" />
      <PageSkeleton height="2.25rem" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <PageSkeleton key={i} height="6rem" />
        ))}
      </div>
      <PageSkeleton height="3.5rem" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
        <PageSkeleton height="18rem" />
        <PageSkeleton height="18rem" />
      </div>
    </div>
  );
}
