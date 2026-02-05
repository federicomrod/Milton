// Data table service for managing centralized table definitions
import { createClient } from "@/lib/supabase/client";
import type { DataTable, DataTableField } from "@/lib/types/data";

/**
 * Get a single data table by ID
 */
export async function getDataTable(id: string): Promise<DataTable | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("data_tables")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("[getDataTable] error:", error);
      return null;
    }

    return data as DataTable;
  } catch (err) {
    console.error("[getDataTable] unexpected error:", err);
    return null;
  }
}

/**
 * Get a single data table by slug
 */
export async function getDataTableBySlug(
  slug: string
): Promise<DataTable | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("data_tables")
      .select("*")
      .eq("slug", slug)
      .single();

    if (error) {
      console.error("[getDataTableBySlug] error:", error);
      return null;
    }

    return data as DataTable;
  } catch (err) {
    console.error("[getDataTableBySlug] unexpected error:", err);
    return null;
  }
}

/**
 * Get all data tables for a specific business model template
 */
export async function getDataTablesForTemplate(
  templateKey: string
): Promise<DataTable[]> {
  try {
    const supabase = createClient();

    // Get the template to find its required table IDs
    const { data: template, error: templateError } = await supabase
      .from("business_model_templates")
      .select("required_table_ids")
      .eq("key", templateKey)
      .single();

    if (templateError) {
      console.error(
        "[getDataTablesForTemplate] template error:",
        templateError
      );
      return [];
    }

    if (
      !template.required_table_ids ||
      !Array.isArray(template.required_table_ids)
    ) {
      return [];
    }

    // Fetch the actual data tables
    const { data, error } = await supabase
      .from("data_tables")
      .select("*")
      .in("id", template.required_table_ids)
      .order("name");

    if (error) {
      console.error("[getDataTablesForTemplate] data tables error:", error);
      return [];
    }

    return (data as DataTable[]) || [];
  } catch (err) {
    console.error("[getDataTablesForTemplate] unexpected error:", err);
    return [];
  }
}

/**
 * Get all data tables (public read access)
 */
export async function getAllDataTables(): Promise<DataTable[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("data_tables")
      .select("*")
      .order("name");

    if (error) {
      console.error("[getAllDataTables] error:", error);
      return [];
    }

    return (data as DataTable[]) || [];
  } catch (err) {
    console.error("[getAllDataTables] unexpected error:", err);
    return [];
  }
}

/**
 * Alias for getAllDataTables (for consistency)
 */
export async function getDataTables(): Promise<DataTable[]> {
  return getAllDataTables();
}

/**
 * Get multiple data tables by their IDs
 */
export async function getDataTablesByIds(ids: string[]): Promise<DataTable[]> {
  if (!ids || ids.length === 0) {
    return [];
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("data_tables")
      .select("*")
      .in("id", ids)
      .order("name");

    if (error) {
      console.error("[getDataTablesByIds] error:", error);
      return [];
    }

    return (data as DataTable[]) || [];
  } catch (err) {
    console.error("[getDataTablesByIds] unexpected error:", err);
    return [];
  }
}

/**
 * Create a new data table (admin only)
 * RLS policies enforce admin-only access
 */
export async function createDataTable(
  table: Omit<DataTable, "id" | "created_at" | "updated_at">
): Promise<DataTable | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("data_tables")
      .insert({
        slug: table.slug,
        name: table.name,
        description: table.description || null,
        fields: table.fields || [],
      })
      .select()
      .single();

    if (error) {
      console.error("[createDataTable] error:", error);
      return null;
    }

    return data as DataTable;
  } catch (err) {
    console.error("[createDataTable] unexpected error:", err);
    return null;
  }
}

/**
 * Update an existing data table (admin only)
 * RLS policies enforce admin-only access
 */
export async function updateDataTable(
  id: string,
  updates: Partial<Omit<DataTable, "id" | "created_at" | "updated_at">>
): Promise<DataTable | null> {
  try {
    // Remove business_model_template_key from updates if it exists (for backward compatibility)
    const { business_model_template_key, ...cleanUpdates } = updates as any;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("data_tables")
      .update(cleanUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[updateDataTable] error:", error);
      return null;
    }

    return data as DataTable;
  } catch (err) {
    console.error("[updateDataTable] unexpected error:", err);
    return null;
  }
}

/**
 * Delete a data table (admin only)
 * RLS policies enforce admin-only access
 */
export async function deleteDataTable(id: string): Promise<void> {
  try {
    const supabase = createClient();
    const { error } = await supabase.from("data_tables").delete().eq("id", id);

    if (error) {
      console.error("[deleteDataTable] error:", error);
      throw error;
    }
  } catch (err) {
    console.error("[deleteDataTable] unexpected error:", err);
    throw err;
  }
}
