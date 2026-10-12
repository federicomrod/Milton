"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { withShellParams } from "@/lib/restaurant/navigation";

export function MenuAreaTabs({
  lang,
  active,
}: {
  lang: PreferredLanguage;
  active: "resumen" | "recetas";
}) {
  const searchParams = useSearchParams();
  const locationId = searchParams.get("location");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const href = (path: string) =>
    withShellParams(path, { locationId, from, to });
  const tabs = [
    {
      id: "resumen" as const,
      href: href("/dashboard/restaurant/menu"),
      label: t(lang, "Overview", "Resumen"),
    },
    {
      id: "recetas" as const,
      href: href("/dashboard/restaurant/menu/recetas"),
      label: t(lang, "Recipes & costing", "Recetas y costeo"),
    },
  ];
  return (
    <div className="mt-2 flex gap-5 border-b border-slate-200 text-[12.5px] text-slate-500">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={
            "border-b-2 py-1.5 " +
            (active === tab.id
              ? "border-orange-600 font-semibold text-orange-700"
              : "border-transparent hover:text-slate-800")
          }
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
