import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function MenuResumenLoading() {
  return (
    <div className="space-y-3">
      <PageSkeleton height="9rem" width="100%" label="configura tu menú" />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <PageSkeleton key={i} height="6rem" width="100%" label="kpi" />
        ))}
      </div>
      <PageSkeleton height="20rem" width="100%" label="platos" />
    </div>
  );
}
