"use client";

// What a Menú tab shows while its data is read in the browser (R1-12):
// the same slots as the tab's loading.tsx, so nothing jumps when it loads.

import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import { useT } from "@/lib/i18n/client";
import { ListDetailSkeleton } from "./ListDetailSkeleton";

export function MenuTabSkeleton({
  tab,
}: {
  tab: "resumen" | "plato" | "preparaciones";
}) {
  const { d, lang } = useT();
  const s = d.menu.screens.skeleton;
  if (tab !== "resumen") return <ListDetailSkeleton />;
  return (
    <div className="space-y-3">
      <PageSkeleton
        height="9rem"
        width="100%"
        label={s.configureMenu}
        lang={lang}
      />
      <div className="grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <PageSkeleton
            key={i}
            height="6rem"
            width="100%"
            label={s.kpi}
            lang={lang}
          />
        ))}
      </div>
      <PageSkeleton height="20rem" width="100%" label={s.dishes} lang={lang} />
    </div>
  );
}

/** Menú › Ingredientes: the same slots as the screen (loading.tsx). */
export function IngredientesSkeleton() {
  const { d, lang } = useT();
  const s = d.menu.screens.skeleton;
  return (
    <div className="mt-3 grid grid-cols-[330px_1fr] gap-[14px]">
      <div className="space-y-2 rounded-[14px] border border-[#eef0f4] bg-white p-3">
        <PageSkeleton
          height="2.25rem"
          width="100%"
          label={s.searchIngredient}
          lang={lang}
        />
        <PageSkeleton
          height="1.75rem"
          width="60%"
          label={s.filters}
          lang={lang}
        />
        {Array.from({ length: 9 }, (_, i) => (
          <PageSkeleton
            key={i}
            height="2.75rem"
            width="100%"
            label={s.ingredient}
            lang={lang}
          />
        ))}
      </div>
      <div className="space-y-4 rounded-[14px] border border-[#eef0f4] bg-white p-5">
        <PageSkeleton
          height="1.75rem"
          width="14rem"
          label={s.ingredient}
          lang={lang}
        />
        <div className="flex gap-10">
          <PageSkeleton
            height="3.5rem"
            width="12rem"
            label={s.currentPrice}
            lang={lang}
          />
          <PageSkeleton
            height="3.5rem"
            width="10rem"
            label={s.change30}
            lang={lang}
          />
        </div>
        <PageSkeleton
          height="1.25rem"
          width="24rem"
          label={s.supplier}
          lang={lang}
        />
        <PageSkeleton
          height="12rem"
          width="100%"
          label={s.usedIn}
          lang={lang}
        />
      </div>
    </div>
  );
}
