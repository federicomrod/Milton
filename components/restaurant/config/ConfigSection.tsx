// components/restaurant/config/ConfigSection.tsx
//
// One Configuración card: white, #E5E7EB border, an anchor id the index and
// the old ?tab= links scroll to. Server-safe (no hooks).

export function ConfigSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={`config-${id}`}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-28 rounded-xl border border-[#E5E7EB] bg-white p-4 text-[#0F172A] sm:p-5"
    >
      <h2 id={`${id}-title`} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** A label with its current value; an empty value reads «Falta: añadir». */
export function ConfigValue({
  label,
  value,
  missing,
}: {
  label: string;
  value: React.ReactNode;
  /** The «Falta: añadir» text (shared.missing). */
  missing: string;
}) {
  const empty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="w-44 shrink-0 text-[13px] text-[#64748B]">{label}</dt>
      <dd
        className={
          "min-w-0 break-words text-sm " +
          (empty ? "text-[#64748B]" : "font-medium")
        }
      >
        {empty ? missing : value}
      </dd>
    </div>
  );
}
