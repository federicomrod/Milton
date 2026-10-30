"use client";

// Same slots as the list + detail tabs, so nothing jumps when they load.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { useT } from "@/lib/i18n/client";

export function ListDetailSkeleton() {
  const { d, lang } = useT();
  const s = d.menu.screens.skeleton;
  return (
    <div className="grid grid-cols-[330px_1fr] gap-[14px]">
      <PageSkeleton height="36rem" width="100%" label={s.list} lang={lang} />
      <PageSkeleton height="36rem" width="100%" label={s.detail} lang={lang} />
    </div>
  );
}
