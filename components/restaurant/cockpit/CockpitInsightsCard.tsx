// components/restaurant/cockpit/CockpitInsightsCard.tsx
//
// Milton briefing: at most 3 backend-selected insights. AI only words them.

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { WordedCockpitInsight } from "@/lib/restaurant/cockpit-insights";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export function CockpitInsightsCard({
  lang,
  insights,
  source,
}: {
  lang: PreferredLanguage;
  insights: WordedCockpitInsight[];
  source: "openai" | "deterministic";
}) {
  return (
    <section
      data-testid="cockpit-insights"
      className="rounded-md border border-border px-3 py-2.5 min-h-[8.5rem]"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          {t(lang, "Milton briefing", "Briefing de Milton")}
        </h2>
        <span className="text-[10px] text-muted-foreground">
          {source === "openai"
            ? t(lang, "Wording by Milton", "Redacción de Milton")
            : t(lang, "Deterministic wording", "Redacción determinista")}
        </span>
      </div>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            lang,
            "No material insight for this period yet.",
            "Aún no hay un hallazgo material para este periodo."
          )}
        </p>
      ) : (
        <ol className="space-y-2">
          {insights.slice(0, 3).map((insight, index) => (
            <li key={insight.id} className="text-sm">
              <p className="font-medium">
                <span className="text-muted-foreground mr-1.5 tabular-nums">
                  {index + 1}.
                </span>
                {insight.title}
              </p>
              <p className="text-muted-foreground mt-0.5 leading-snug">
                {insight.body}
              </p>
              {insight.action ? (
                <Link
                  href={insight.action.href}
                  className="inline-block mt-0.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-sm"
                >
                  {insight.action.label}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function CockpitInsightsCardSkeleton() {
  return (
    <div className="rounded-md border border-border px-3 py-2.5 min-h-[8.5rem]">
      <PageSkeleton height="8.5rem" width="100%" />
    </div>
  );
}
