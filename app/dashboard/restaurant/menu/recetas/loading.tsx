// Shown at once while Recetas y costeo renders on the server (coming from
// the sidebar, Menú › Resumen or a redirect). Same slots as the screen, so
// nothing jumps when it arrives.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function RecetasCosteoLoading() {
  return (
    <div className="w-full space-y-3 px-[22px] pt-3">
      <PageSkeleton height="2rem" width="12rem" label="recetas header" />
      <PageSkeleton height="1.75rem" width="20rem" label="recetas tabs" />
      <PageSkeleton height="4.5rem" width="100%" label="recetas checklist" />
      <PageSkeleton height="9rem" width="100%" label="recetas coverage" />
      <PageSkeleton height="14rem" width="100%" label="recetas dishes" />
    </div>
  );
}
