// components/restaurant/cockpit/CockpitHeadline.tsx
//
// One-line greeting. Text is computed on the server from backend numbers.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export function CockpitHeadline({ text }: { text: string }) {
  return (
    <p
      data-testid="cockpit-headline"
      className="text-sm sm:text-base font-medium leading-snug min-h-6"
    >
      {text}
    </p>
  );
}

export function CockpitHeadlineSkeleton() {
  return (
    <PageSkeleton
      height="1.5rem"
      width="100%"
      label="headline"
      className="max-w-3xl"
    />
  );
}
