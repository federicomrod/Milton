// Just enough of the Supabase client for pos_product_links reads and writes.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;

export function fakeLinksSupabase(
  rows: Row[],
  opts: { rejectNewValues?: boolean } = {}
) {
  const legacy = new Set([
    "por_clasificar",
    "requiere_receta",
    "componente",
    "no_requiere_costeo",
  ]);
  const check = (payload: Row) =>
    opts.rejectNewValues && !legacy.has(String(payload.classification))
      ? {
          message:
            'new row violates check constraint "pos_product_links_classification_chk"',
        }
      : null;
  return {
    from() {
      const filters: Array<[string, unknown]> = [];
      let inFilter: [string, unknown[]] | null = null;
      let mode: "select" | "update" | "insert" = "select";
      let payload: Row = {};
      const match = (row: Row) =>
        filters.every(([k, v]) => row[k] === v) &&
        (!inFilter || inFilter[1].includes(row[inFilter[0]]));
      const builder = {
        select() {
          return builder;
        },
        eq(k: string, v: unknown) {
          filters.push([k, v]);
          return builder;
        },
        in(k: string, v: unknown[]) {
          inFilter = [k, v];
          return builder;
        },
        update(p: Row) {
          mode = "update";
          payload = p;
          return builder;
        },
        insert(p: Row) {
          mode = "insert";
          payload = p;
          return builder;
        },
        single() {
          const error = check(payload);
          if (error) return Promise.resolve({ data: null, error });
          const row = { ...payload, id: `link-${rows.length + 1}` };
          rows.push(row);
          return Promise.resolve({ data: { id: row.id }, error: null });
        },
        then(resolve: (v: unknown) => void) {
          if (mode === "update") {
            const error = check(payload);
            if (!error) {
              for (const row of rows)
                if (match(row)) Object.assign(row, payload);
            }
            return resolve({ error });
          }
          return resolve({ data: rows.filter(match), error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}
