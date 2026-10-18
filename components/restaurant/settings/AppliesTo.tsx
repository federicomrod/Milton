"use client";

import { useRouter } from "next/navigation";

/** «Aplica a: Todos los restaurantes ▾». A restaurant is its own set of targets. */
export function AppliesTo({
  restaurants,
  value,
}: {
  restaurants: Array<{ id: string; name: string }>;
  value: string | null;
}) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 rounded-[9px] border border-[#c6d3f5] bg-white px-3 py-1.5 text-[13px]">
      Aplica a:
      <select
        aria-label="Aplica a"
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
        <option value="">Todos los restaurantes</option>
        {restaurants.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
