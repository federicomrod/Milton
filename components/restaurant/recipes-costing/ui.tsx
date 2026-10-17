import { cn } from "@/lib/utils";

export function Chip({
  tone,
  children,
}: {
  tone: "ok" | "sug" | "warn" | "bad" | "grey" | "pur";
  children: React.ReactNode;
}) {
  const tones = {
    ok: "bg-[#e7f6ee] text-[#1f7a45]",
    sug: "bg-[#e9efff] text-[#3557c9]",
    warn: "bg-[#fff4e5] text-[#a35a00]",
    bad: "bg-[#fdecec] text-[#c03535]",
    grey: "bg-[#f1f3f7] text-[#5b6476]",
    pur: "bg-[#f2ecff] text-[#6b3fc9]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

export function toneForKind(
  kind: string
): "ok" | "sug" | "warn" | "bad" | "grey" | "pur" {
  if (kind === "Confirmado" || kind === "Aprobado") return "ok";
  if (kind === "Sugerido" || kind === "Reventa") return "sug";
  if (kind === "Por revisar" || kind === "Falta precio") return "warn";
  if (kind === "Ambiguo") return "bad";
  if (kind === "Combo") return "pur";
  return "grey";
}

export function GhostBtn({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-[#1B40C8] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#1B40C8] hover:bg-[#f6f8fe] disabled:opacity-45",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PrimaryBtn({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-[#1B40C8] bg-[#1B40C8] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#1535a6] disabled:cursor-not-allowed disabled:border-[#b9c7f0] disabled:bg-[#b9c7f0] disabled:opacity-100",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function DarkBtn({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-[#151c2c] bg-[#151c2c] px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-[#0f1522] disabled:opacity-45",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-4",
        className
      )}
    >
      {children}
    </div>
  );
}
