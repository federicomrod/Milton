import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function MenuAreaLoading() {
  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <PageSkeleton height="2rem" width="8rem" label="menu header" />
      <PageSkeleton height="16rem" width="100%" label="menu profitability" />
    </div>
  );
}
