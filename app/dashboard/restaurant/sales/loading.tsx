// app/dashboard/restaurant/sales/loading.tsx
//
// Slot-sized skeletons — not a full-page "reading numbers" box.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { SalesInterpretationSkeleton } from "@/components/restaurant/sales/SalesInterpretation";

export default function SalesLoading() {
  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <PageSkeleton width="16rem" height="2.5rem" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <PageSkeleton className="lg:col-span-2" height="16rem" />
        <PageSkeleton height="16rem" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <PageSkeleton height="4.5rem" />
        <PageSkeleton height="4.5rem" />
        <PageSkeleton height="4.5rem" />
      </div>
      <SalesInterpretationSkeleton lang="es" />
      <PageSkeleton height="14rem" />
    </div>
  );
}
