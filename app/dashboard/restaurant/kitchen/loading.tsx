// app/dashboard/restaurant/kitchen/loading.tsx
//
// Slot-sized skeletons — same shell as Sales, matching the new layout.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function KitchenLoading() {
  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <PageSkeleton width="16rem" height="2.5rem" />
      <PageSkeleton width="28rem" height="1rem" />
      <div className="lg:flex lg:gap-6">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <PageSkeleton height="5.5rem" />
            <PageSkeleton height="5.5rem" />
            <PageSkeleton height="5.5rem" />
          </div>
          <PageSkeleton height="14rem" />
          <PageSkeleton height="12rem" />
          <PageSkeleton height="10rem" />
        </div>
        <PageSkeleton
          className="hidden lg:block w-[300px] xl:w-[320px]"
          height="22rem"
        />
      </div>
    </div>
  );
}
