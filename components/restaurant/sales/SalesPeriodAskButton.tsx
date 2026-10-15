// components/restaurant/sales/SalesPeriodAskButton.tsx
//
// One page-level Ask Milton action. The question is already computed.

"use client";

import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { useAskMiltonController } from "@/components/restaurant/shell/ask-milton-controller";

export function SalesPeriodAskButton({
  question,
  lang,
  label,
  testId = "sales-ask-milton-period",
}: {
  question: string;
  lang: PreferredLanguage;
  label?: string;
  testId?: string;
}) {
  const { openAskMilton } = useAskMiltonController();

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => openAskMilton(question)}
      className="hidden lg:inline-flex h-8 items-center rounded-lg bg-[#151c2c] px-3 text-xs font-semibold text-white hover:bg-[#26314a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1b40c8] whitespace-nowrap"
    >
      ✦ {label ?? t(lang, "Ask Milton", "Preguntar a Milton")}
    </button>
  );
}
