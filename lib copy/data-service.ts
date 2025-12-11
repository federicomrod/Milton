// lib/data-service.ts
import { SupabaseClient } from '@supabase/supabase-js'

export interface FileSummary {
  name: string
  label: string
  count: number
  updated_at: string | null
}

/**
 * Fetch uploaded file summaries from Supabase with accurate record counts
 */
export const getUploadedFilesSummary = async (
  supabase: SupabaseClient,
  userId: string
): Promise<FileSummary[]> => {
  const tables = [
    { name: 'transactions', label: 'Bank Transactions' },
    { name: 'crm_deals', label: 'CRM Data' },
    { name: 'budgets', label: 'Budget Data' }
  ]

  const results = await Promise.all(
    tables.map(async (t) => {
      const { count, error } = await supabase
        .from(t.name)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)

      if (error) {
        console.warn(`⚠️ Could not count rows for ${t.name}:`, error.message)
        return { ...t, count: 0, updated_at: null }
      }

      return { ...t, count: count ?? 0, updated_at: new Date().toISOString() }
    })
  )

  console.log(
    '📊 Fetched file summaries:',
    results.map((r) => `${r.name}=${r.count}`).join(', ')
  )

  return results
}

/**
 * Delete all records for a specific table/file type
 */
export const deleteFileData = async (
  supabase: SupabaseClient,
  userId: string,
  tableName: string
): Promise<{ success: boolean; error?: string }> => {
  const { error } = await supabase
    .from(tableName)
    .delete()
    .eq('user_id', userId)

  if (error) {
    console.error(`❌ Failed to delete ${tableName}:`, error.message)
    return { success: false, error: error.message }
  }

  console.log(`✅ Successfully deleted all ${tableName} for user ${userId.substring(0, 8)}...`)
  return { success: true }
}

