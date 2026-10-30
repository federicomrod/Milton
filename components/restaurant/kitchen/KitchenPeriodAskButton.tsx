// components/restaurant/kitchen/KitchenPeriodAskButton.tsx
//
// The single page-level Ask Milton action for Cocina.

"use client";

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { useAskMiltonController } from "@/components/restaurant/shell/ask-milton-controller";

export function KitchenPeriodAskButton({
  question,
  lang,
}: {
  question: string;
  lang: PreferredLanguage;
}) {
  const { openAskMilton } = useAskMiltonController();

  return (
    <button
      type="button"
      data-testid="kitchen-ask-milton"
      onClick={() => openAskMilton(question)}
      className="inline-flex items-center rounded-lg bg-foreground text-background h-8 px-3 text-xs font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
    >
      {t(lang, "Ask Milton", "Preguntar a Milton", "Ask Milton")}
    </button>
  );
}
