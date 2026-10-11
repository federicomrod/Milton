// components/restaurant/sales/SalesContextualAsk.tsx
//
// Appears after the operator selects something (heatmap cell, detail).

"use client";

import { useAskMiltonController } from "@/components/restaurant/shell/ask-milton-controller";

export function SalesContextualAsk({
  question,
  testId,
}: {
  question: string;
  testId: string;
}) {
  const { openAskMilton } = useAskMiltonController();

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => openAskMilton(question)}
      className="text-xs font-medium text-orange-700 dark:text-orange-300 hover:underline underline-offset-2"
    >
      {question}
    </button>
  );
}
