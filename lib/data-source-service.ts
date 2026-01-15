// lib/data-source-service.ts
"use client";
import { createClient } from "@/lib/supabase/client";
import { DataSourceCategory, ToolDefinition } from "./data-source-tools";

export interface UserDataSource {
  id: string;
  user_id: string;
  category: DataSourceCategory;
  tool_name: string;
  other_text?: string;
  created_at?: string;
  updated_at?: string;
}

export async function getUserDataSources(): Promise<UserDataSource[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from("user_data_sources")
    .select("*")
    .eq("user_id", user.id)
    .order("category", { ascending: true });

  if (error) {
    console.error("Error fetching data sources:", error);
    return [];
  }

  return (data || []) as UserDataSource[];
}

export async function upsertUserDataSources(
  selections: Array<{
    category: DataSourceCategory;
    toolName: string;
    otherText?: string;
  }>
): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not authenticated");

  // Delete existing selections for this user
  await supabase.from("user_data_sources").delete().eq("user_id", user.id);

  // Insert new selections
  if (selections.length > 0) {
    const payload = selections.map((sel) => ({
      user_id: user.id,
      category: sel.category,
      tool_name: sel.toolName,
      other_text: sel.otherText || null,
    }));

    const { error } = await supabase.from("user_data_sources").insert(payload);

    if (error) {
      console.error("Error saving data sources:", error);
      throw error;
    }
  }
}

export async function deleteUserDataSource(sourceId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("User not authenticated");

  const { error } = await supabase
    .from("user_data_sources")
    .delete()
    .eq("id", sourceId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Error deleting data source:", error);
    throw error;
  }
}
