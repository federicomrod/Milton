"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
  const params = useSearchParams();
  const { d } = useT();
  return (
    <label className="inline-flex items-center gap-2 rounded-[9px] border border-[#E5E7EB] bg-white px-3 py-1.5 text-[13px]">
      {d.settings.goals.appliesTo}
      <select
        aria-label={d.settings.goals.appliesToAria}
        value={value ?? ""}
        onChange={(e) => {
          // Stay on the page: only ?aplica= changes, the other params and the
          // Objetivos section stay where they are.
          const next = new URLSearchParams(params?.toString() ?? "");
          next.delete("tab");
          if (e.target.value) next.set("aplica", e.target.value);
          else next.delete("aplica");
          const qs = next.toString();
          router.replace(`${qs ? `?${qs}` : "?"}#objetivos`, {
            scroll: false,
          });
        }}
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
