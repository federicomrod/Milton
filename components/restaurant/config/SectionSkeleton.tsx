export function SectionSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse space-y-2">
      <div className="h-4 w-1/2 rounded bg-[#E5E7EB]" />
      <div className="h-4 w-2/3 rounded bg-[#E5E7EB]" />
      <div className="h-4 w-1/3 rounded bg-[#E5E7EB]" />
    </div>
  );
}
