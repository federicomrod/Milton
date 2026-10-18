// components/restaurant/cockpit/CockpitOnboardingChip.tsx
//
// Incomplete onboarding only: a small chip, never a giant card.

import Link from "next/link";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import type { SetupProgress } from "@/lib/restaurant/setup-progress";

export function CockpitOnboardingChip({
  lang,
  progress,
}: {
  lang: PreferredLanguage;
  progress: SetupProgress;
}) {
  if (progress.complete || !progress.nextHref) return null;
  return (
    <Link
      href={progress.nextHref}
      data-testid="cockpit-onboarding-chip"
      className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-[#1B40C8]/30 dark:border-[#1B40C8]/50 bg-[#1B40C8]/5 dark:bg-[#1B40C8]/20 text-[12px] font-medium text-[#1B40C8] dark:text-[#c9d6fb] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
    >
      {t(
        lang,
        `Set up your menu · ${progress.done}/${progress.total}`,
        `Configura tu menú · ${progress.done}/${progress.total}`
      )}
    </Link>
  );
}
