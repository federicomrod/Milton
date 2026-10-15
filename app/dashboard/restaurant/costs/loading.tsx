import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function CostsAreaLoading() {
  return (
    <div className="w-full px-[26px] pt-4 pb-10 space-y-5">
      <PageSkeleton height="2.5rem" width="14rem" label="costs header" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <PageSkeleton key={i} height="6.5rem" width="100%" label="cost kpi" />
        ))}
      </div>
      <PageSkeleton height="2.75rem" width="100%" label="cost tabs" />
      <PageSkeleton height="16rem" width="100%" label="cost tab content" />
    </div>
  );
}
