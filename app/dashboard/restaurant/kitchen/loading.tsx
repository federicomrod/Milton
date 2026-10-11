// app/dashboard/restaurant/kitchen/loading.tsx
//
// Slot-sized skeletons — same shell as Sales.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function KitchenLoading() {
  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <PageSkeleton width="16rem" height="2.5rem" />
      <PageSkeleton width="28rem" height="1rem" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <PageSkeleton className="lg:col-span-7" height="16rem" />
        <PageSkeleton className="lg:col-span-5" height="16rem" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PageSkeleton height="5.5rem" />
        <PageSkeleton height="5.5rem" />
        <PageSkeleton height="5.5rem" />
      </div>
      <PageSkeleton height="14rem" />
    </div>
  );
}
