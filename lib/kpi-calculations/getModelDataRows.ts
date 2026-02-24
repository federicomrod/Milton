import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fetches and flattens model_data rows for a given table name.
 * Looks up the table ID from data_tables first (model_data has model_table_id, not model_table_name).
 * Tries each name in order, returning the first match.
 */
export async function getModelDataRows(
  supabase: SupabaseClient,
  companyId: string,
  ...tableNames: string[]
): Promise<any[]> {
  for (const tableName of tableNames) {
    const { data: tableDef } = await supabase
      .from("data_tables")
      .select("id")
      .ilike("name", tableName)
      .maybeSingle();

    if (!tableDef) continue;

    const { data: rows, error } = await supabase
      .from("model_data")
      .select("data")
      .eq("company_id", companyId)
      .eq("model_table_id", tableDef.id);

    if (error || !rows?.length) continue;

    return rows.flatMap((row: any) => {
      const d = row.data;
      if (Array.isArray(d)) return d;
      if (d && typeof d === "object") return [d];
      return [];
    });
  }

  return [];
}
