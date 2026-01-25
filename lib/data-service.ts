// lib/data-service.ts
import { SupabaseClient } from "@supabase/supabase-js";

export interface FileSummary {
  name: string;
  label: string;
  count: number;
  updated_at: string | null;
}

export interface UploadedFile {
  id: string;
  file_name: string;
  dataset_type: "bank" | "crm" | "budget";
  table_name: string;
  row_count: number;
  uploaded_at: string;
  created_at: string;
}

/**
 * Fetch model data table summaries via API endpoint for better performance
 */
export const getUploadedFilesSummary = async (
  supabase: SupabaseClient,
  userId: string
): Promise<FileSummary[]> => {
  try {
    // Use the dedicated API endpoint for better performance
    const response = await fetch("/api/data/sources", {
      method: "GET",
      credentials: "include", // Include cookies for authentication
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn("⚠️ Failed to fetch data sources via API:", response.status);
      return [];
    }

    const data = await response.json();

    if (!data.dataSources || !Array.isArray(data.dataSources)) {
      console.warn("⚠️ Invalid data sources response:", data);
      return [];
    }

    // Convert API response to FileSummary format
    const results: FileSummary[] = data.dataSources.map((ds: any) => ({
      name: ds.name,
      label: ds.label,
      count: ds.count,
      updated_at: new Date().toISOString(),
    }));

    console.log(
      "📊 Fetched model table summaries:",
      results.map((r) => `${r.name}=${r.count}`).join(", ")
    );

    return results;
  } catch (error) {
    console.error("Error fetching uploaded files summary:", error);
    return [];
  }
};

/**
 * Fetch individual uploaded files from the uploaded_files metadata table
 * Returns empty array if table doesn't exist or on error
 * If row_count is 0, counts actual records from the data table as fallback
 */
export const getIndividualUploadedFiles = async (
  supabase: SupabaseClient,
  userId: string
): Promise<UploadedFile[]> => {
  try {
    const { data, error } = await supabase
      .from("uploaded_files")
      .select("*")
      .eq("user_id", userId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      // Check if it's a "relation does not exist" error (table not created yet)
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        console.log(
          `[getIndividualUploadedFiles] uploaded_files table does not exist yet. Migration may not have been run.`
        );
        return [];
      }
      console.error(`❌ Failed to fetch uploaded files:`, error.message);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // For files with row_count = 0, count actual records from the data table as fallback
    const filesWithCounts = await Promise.all(
      data.map(async (file) => {
        if (file.row_count > 0) {
          return file; // Already has correct count
        }

        // Count actual records for this file
        try {
          const { count, error: countError } = await supabase
            .from(file.table_name)
            .select("*", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("upload_file_id", file.id);

          if (!countError && count !== null) {
            // Update the row_count in the database
            await supabase
              .from("uploaded_files")
              .update({ row_count: count })
              .eq("id", file.id);

            return { ...file, row_count: count };
          }
        } catch (err) {
          console.warn(
            `[getIndividualUploadedFiles] Failed to count records for file ${file.id}:`,
            err
          );
        }

        return file;
      })
    );

    return filesWithCounts as UploadedFile[];
  } catch (err) {
    console.error(`❌ Exception fetching uploaded files:`, err);
    return [];
  }
};

/**
 * Delete a specific uploaded file by its upload_file_id
 * This will delete the metadata record and cascade delete all associated data rows
 */
export const deleteIndividualFile = async (
  supabase: SupabaseClient,
  userId: string,
  uploadFileId: string
): Promise<{ success: boolean; error?: string }> => {
  // First verify the file belongs to the user
  const { data: file, error: fetchError } = await supabase
    .from("uploaded_files")
    .select("id, table_name")
    .eq("id", uploadFileId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !file) {
    return { success: false, error: "File not found or access denied" };
  }

  // Delete the uploaded_files record - this will cascade delete all associated data rows
  // due to the foreign key constraint with ON DELETE CASCADE
  const { error } = await supabase
    .from("uploaded_files")
    .delete()
    .eq("id", uploadFileId)
    .eq("user_id", userId);

  if (error) {
    console.error(`❌ Failed to delete uploaded file:`, error.message);
    return { success: false, error: error.message };
  }

  console.log(
    `✅ Successfully deleted uploaded file ${uploadFileId} and all associated data`
  );
  return { success: true };
};

/**
 * Check if a file with the same name has been uploaded before
 * If row_count is 0, counts actual records from the data table as fallback
 */
export const checkExistingFileByName = async (
  supabase: SupabaseClient,
  userId: string,
  fileName: string
): Promise<UploadedFile | null> => {
  try {
    const { data, error } = await supabase
      .from("uploaded_files")
      .select("*")
      .eq("user_id", userId)
      .eq("file_name", fileName)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // PGRST116 = no rows returned (not found)
      if (error.code === "PGRST116") {
        return null;
      }
      // Table might not exist yet
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        return null;
      }
      console.warn(
        `[checkExistingFileByName] Error checking file:`,
        error.message
      );
      return null;
    }

    if (!data) {
      return null;
    }

    // If row_count is 0, count actual records from the data table as fallback
    if (data.row_count === 0) {
      try {
        const { count, error: countError } = await supabase
          .from(data.table_name)
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("upload_file_id", data.id);

        if (!countError && count !== null) {
          // Update the row_count in the database
          await supabase
            .from("uploaded_files")
            .update({ row_count: count })
            .eq("id", data.id);

          return { ...data, row_count: count } as UploadedFile;
        }
      } catch (err) {
        console.warn(
          `[checkExistingFileByName] Failed to count records for file ${data.id}:`,
          err
        );
      }
    }

    return data as UploadedFile;
  } catch (err) {
    console.warn(`[checkExistingFileByName] Exception checking file:`, err);
    return null;
  }
};

/**
 * Delete all records for a specific table/file type
 * @deprecated Use deleteIndividualFile for deleting specific files
 */
export const deleteFileData = async (
  supabase: SupabaseClient,
  userId: string,
  tableName: string
): Promise<{ success: boolean; error?: string }> => {
  // Also delete all uploaded_files metadata for this table
  await supabase
    .from("uploaded_files")
    .delete()
    .eq("user_id", userId)
    .eq("table_name", tableName);

  const { error } = await supabase
    .from(tableName)
    .delete()
    .eq("user_id", userId);

  if (error) {
    console.error(`❌ Failed to delete ${tableName}:`, error.message);
    return { success: false, error: error.message };
  }

  console.log(
    `✅ Successfully deleted all ${tableName} for user ${userId.substring(0, 8)}...`
  );
  return { success: true };
};
