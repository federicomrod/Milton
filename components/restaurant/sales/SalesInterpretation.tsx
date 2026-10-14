// components/restaurant/sales/SalesInterpretation.tsx
//
// One line of Milton's read. Deterministic first; AI may only reword.

import { t, type PreferredLanguage } from "@/lib/restaurant/language";

export function SalesInterpretation({
  title,
  body,
  lang,
  source,
}: {
  title: string;
  body: string;
  lang: PreferredLanguage;
  source: "openai" | "deterministic";
}) {
  return (
    <section
      data-testid="sales-interpretation"
      data-source={source}
      className="rounded-md border border-border bg-muted/30 px-3 py-2.5"
    >
      <p className="text-[12px] uppercase tracking-wide text-muted-foreground">
        {title || t(lang, "Milton's read", "La lectura de Milton")}
      </p>
      <p className="text-sm leading-snug mt-0.5">{body}</p>
    </section>
  );
}

export function SalesInterpretationSkeleton({
  lang,
}: {
  lang: PreferredLanguage;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="sales-interpretation-skeleton"
      className="rounded-md border border-border bg-muted/30 px-3 py-2.5 h-[3.25rem] animate-pulse"
    >
      <span className="sr-only">
        {t(lang, "Loading Milton's read", "Cargando la lectura de Milton")}
      </span>
    </div>
  );
}
