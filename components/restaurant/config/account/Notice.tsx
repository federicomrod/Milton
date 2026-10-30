// Inline message in the Configuración style: ink text, no red/green.
// Errors carry a ⚑ and an ink border; success is a mint chip.
export function Notice({
  kind,
  children,
}: {
  kind: "ok" | "error";
  children: React.ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        "min-w-0 break-words rounded-lg border px-3 py-2 text-sm text-[#0F172A] " +
        (kind === "error"
          ? "border-[#0F172A] bg-white"
          : "border-[#A7F3D0] bg-[#A7F3D0]/40")
      }
    >
      {kind === "error" ? <span aria-hidden="true">⚑ </span> : null}
      {children}
    </p>
  );
}
