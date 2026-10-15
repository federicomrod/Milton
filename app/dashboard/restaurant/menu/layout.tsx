// app/dashboard/restaurant/menu/layout.tsx
//
// Menú (R1-09b): header and the four tabs render once here; switching
// tabs only renders the tab's own page. Auth, company and shell chrome
// are per-request cached (loadRestaurantShellChrome), so each tab page
// reuses them instead of loading them again.

import { Suspense } from "react";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { MenuAreaTabs } from "@/components/restaurant/recipes-costing/MenuAreaTabs";
import { t } from "@/lib/restaurant/language";
import { StickyMenuHeader } from "@/components/restaurant/ui/StickyPanel";

export default async function MenuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { lang } = await loadRestaurantShellChrome();
  return (
    <div className="w-full px-[26px] pb-10">
      {/* R1-15h: header and tabs stay fixed while a long table scrolls. */}
      <StickyMenuHeader>
        <OperatingPageHeader
          title={t(lang, "Menu", "Menú")}
          lang={lang}
          showDateRange={false}
        />
        <Suspense fallback={<div className="mt-2 mb-2 h-[42px]" />}>
          <MenuAreaTabs lang={lang} />
        </Suspense>
      </StickyMenuHeader>
      <div className="pt-3">{children}</div>
    </div>
  );
}
