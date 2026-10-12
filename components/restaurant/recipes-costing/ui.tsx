import { cn } from "@/lib/utils";

export function Chip({
  tone,
  children,
}: {
  tone: "ok" | "sug" | "warn" | "bad" | "grey" | "pur";
  children: React.ReactNode;
}) {
  const tones = {
    ok: "bg-emerald-50 text-emerald-800",
    sug: "bg-blue-50 text-blue-800",
    warn: "bg-amber-50 text-amber-800",
    bad: "bg-red-50 text-red-700",
    grey: "bg-slate-100 text-slate-600",
    pur: "bg-violet-50 text-violet-800",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap",
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
  if (kind === "Sugerido") return "sug";
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
        "inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-45",
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
        "inline-flex items-center justify-center rounded-md border border-[#f28c28] bg-[#f28c28] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#e07b1a] disabled:opacity-45",
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
        "inline-flex items-center justify-center rounded-md border border-[#151c2c] bg-[#151c2c] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[#0f1522] disabled:opacity-45",
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
