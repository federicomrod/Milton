import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function ConfiguracionLoading() {
  return (
    <div className="w-full px-[26px] pt-4 pb-10 space-y-6 max-w-3xl">
      <PageSkeleton height="2.5rem" width="12rem" label="settings header" />
      <PageSkeleton height="9rem" width="100%" label="connections" />
      <PageSkeleton height="3.5rem" width="100%" label="team" />
      <PageSkeleton height="6rem" width="100%" label="account" />
    </div>
  );
}
