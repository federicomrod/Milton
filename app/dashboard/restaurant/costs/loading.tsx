import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function CostsAreaLoading() {
  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <PageSkeleton height="2rem" width="8rem" label="costs header" />
      <PageSkeleton height="12rem" width="100%" label="supplier trends" />
    </div>
  );
}
