// The ingredient list for pickers (Reventa…), read once per minute, not on every
// open. Archived (merged or hidden) ingredients are never offered. A merge, an
// undo or an archive clears it so the change shows right away.

export interface IngredientOption {
  id: string;
  name: string;
  default_unit: string | null;
  /** The latest cost entry's price (null = Sin precio). */
  latest_unit_cost: number | null;
}

let cache: { at: number; rows: Promise<IngredientOption[]> } | null = null;

export function clearIngredientOptionsCache(): void {
  cache = null;
}

export function loadIngredientOptions(): Promise<IngredientOption[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows;
  const rows = fetch("/api/restaurant/ingredients?activos=1").then(
    async (res) => {
      const json = (await res.json().catch(() => ({}))) as {
        ingredients?: IngredientOption[];
      };
      if (!res.ok) throw new Error("ingredients");
      return json.ingredients ?? [];
    }
  );
  cache = { at: Date.now(), rows };
  rows.catch(() => {
    cache = null;
  });
  return rows;
}
