import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function SalesAreaLoading() {
  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <PageSkeleton height="2rem" width="10rem" label="sales header" />
      <PageSkeleton height="220px" width="100%" label="heatmap" />
      <PageSkeleton height="320px" width="100%" label="explorer" />
    </div>
  );
}
