// components/restaurant/shell/PageSkeleton.tsx
//
// Loading placeholder that occupies the FINAL slot size so the layout
// does not jump when real content arrives. No full-page "Reading your
// latest restaurant numbers..." boxes.

export function PageSkeleton({
  className = "",
  width,
  height,
  label,
}: {
  className?: string;
  /** CSS width of the reserved slot (e.g. "100%", "12rem"). */
  width?: string;
  /** CSS height of the reserved slot (e.g. "2.5rem", "180px"). */
  height?: string;
  /** Accessible name; not shown visually. */
  label?: string;
}) {
  const style: { width?: string; height?: string } = {};
  if (width) style.width = width;
  if (height) style.height = height;

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="page-skeleton"
      className={
        "animate-pulse rounded-md bg-muted/70 " +
        (width || height ? "" : "w-full h-full ") +
        className
      }
      style={Object.keys(style).length > 0 ? style : undefined}
    >
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
