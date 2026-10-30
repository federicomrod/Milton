"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";

/** «Aplica a: Todos los restaurantes ▾». A restaurant is its own set of targets. */
export function AppliesTo({
  restaurants,
  value,
}: {
  restaurants: Array<{ id: string; name: string }>;
  value: string | null;
}) {
  const router = useRouter();
  const { d } = useT();
  return (
    <label className="inline-flex items-center gap-2 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px]">
      {d.settings.goals.appliesTo}
      <select
        aria-label={d.settings.goals.appliesToAria}
        value={value ?? ""}
        onChange={(e) =>
          router.push(
            e.target.value
              ? `?tab=objetivos&aplica=${encodeURIComponent(e.target.value)}`
              : "?tab=objetivos"
          )
        }
        className="bg-transparent font-bold outline-none"
      >
        <option value="">{d.settings.goals.allRestaurants}</option>
        {restaurants.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
