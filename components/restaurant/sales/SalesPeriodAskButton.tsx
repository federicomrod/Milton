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
      className="text-xs font-medium text-orange-700 dark:text-orange-300 hover:underline underline-offset-2 whitespace-nowrap"
    >
      {label ??
        t(
          lang,
          "Ask Milton about this period",
          "Preguntar a Milton sobre este periodo"
        )}
    </button>
  );
}
