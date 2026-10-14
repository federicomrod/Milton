// Same slots as the list + detail tabs, so nothing jumps when they load.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export function ListDetailSkeleton() {
  return (
    <div className="grid grid-cols-[330px_1fr] gap-[14px]">
      <PageSkeleton height="36rem" width="100%" label="lista" />
      <PageSkeleton height="36rem" width="100%" label="detalle" />
    </div>
  );
}
