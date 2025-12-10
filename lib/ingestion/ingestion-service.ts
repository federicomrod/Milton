// lib/ingestion/ingestion-service.ts
// Unified ingestion service for all file uploads (dashboard + data model builder)

import { SupabaseClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export interface IngestFileParams {
  supabase: SupabaseClient
  userId: string
  file: File
  datasetType: 'bank' | 'crm' | 'budget'
  mode: 'overwrite' | 'append'
}

export interface IngestFileResult {
  success: boolean
  insertedCount: number
  datasetType: string
  mode: string
  error?: string
}

/**
 * Insert pre-processed data directly into normalized tables
 * Used when data has already been parsed and mapped (e.g., by AI processing)
 */
export async function insertProcessedData({
  supabase,
  userId,
  datasetType,
  data,
  mode = 'append'
}: {
  supabase: SupabaseClient
  userId: string
  datasetType: 'bank' | 'crm' | 'budget'
  data: any[]
  mode?: 'overwrite' | 'append'
}): Promise<IngestFileResult> {
  try {
    console.log(`[Ingestion] Inserting ${data.length} pre-processed ${datasetType} rows (mode: ${mode})`)

    // Handle overwrite mode
    if (mode === 'overwrite') {
      if (datasetType === 'bank') {
        const { error } = await supabase.from('transactions').delete().eq('user_id', userId)
        if (error) throw error
      } else if (datasetType === 'crm') {
        const { error } = await supabase.from('crm_deals').delete().eq('user_id', userId)
        if (error) throw error
      } else if (datasetType === 'budget') {
        const { error } = await supabase.from('budgets').delete().eq('user_id', userId)
        if (error) throw error
      }
    }

    // Insert data
    let insertedCount = 0
    if (datasetType === 'bank') {
      const { error } = await supabase.from('transactions').insert(data)
      if (error) throw error
      insertedCount = data.length
    } else if (datasetType === 'crm') {
      const { error } = await supabase.from('crm_deals').insert(data)
      if (error) throw error
      insertedCount = data.length
    } else if (datasetType === 'budget') {
      const { error } = await supabase.from('budgets').insert(data)
      if (error) throw error
      insertedCount = data.length
    }

    console.log(`[Ingestion] Successfully inserted ${insertedCount} rows`)
    return { success: true, insertedCount, datasetType, mode }
  } catch (error: any) {
    console.error('[Ingestion] Insert error:', error)
    return {
      success: false,
      insertedCount: 0,
      datasetType,
      mode,
      error: error.message || 'Insert failed'
    }
  }
}

/**
 * Unified ingestion service that handles:
 * 1. File parsing (CSV/XLSX)
 * 2. Mode handling (overwrite/append)
 * 3. Data normalization by type
 * 4. Supabase insertion
 */
export async function ingestUploadedFile({
  supabase,
  userId,
  file,
  datasetType,
  mode,
}: IngestFileParams): Promise<IngestFileResult> {
  try {
    console.log(`[Ingestion] Processing ${datasetType} file: ${file.name} (mode: ${mode})`)

    // Step 1: Parse the file
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    if (buffer.length === 0) {
      throw new Error('Empty file uploaded')
    }

    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error('File too large (max 10MB)')
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json(worksheet)

    if (jsonData.length === 0) {
      throw new Error('File contains no data')
    }

    console.log(`[Ingestion] Parsed ${jsonData.length} rows from ${file.name}`)

    // Step 2: Handle overwrite mode - delete existing data
    if (mode === 'overwrite') {
      console.log(`[Ingestion] Overwriting existing ${datasetType} data for user ${userId}`)
      
      if (datasetType === 'bank') {
        const { error } = await supabase.from('transactions').delete().eq('user_id', userId)
        if (error) throw error
      } else if (datasetType === 'crm') {
        const { error } = await supabase.from('crm_deals').delete().eq('user_id', userId)
        if (error) throw error
      } else if (datasetType === 'budget') {
        const { error } = await supabase.from('budgets').delete().eq('user_id', userId)
        if (error) throw error
      }
    }

    // Step 3: Normalize and insert data based on type
    let insertedCount = 0

    if (datasetType === 'bank') {
      // Map CSV columns to transactions table
      const transactions = jsonData.map((row: any) => ({
        user_id: userId,
        date: row.date || row.Date || row.DATE || new Date().toISOString(),
        amount: parseFloat(row.amount || row.Amount || row.AMOUNT || '0'),
        description: row.description || row.Description || row.DESCRIPTION || '',
        category: row.category || row.Category || row.CATEGORY || 'Uncategorized',
        name: row.name || row.Name || row.NAME || row.description || ''
      }))

      const { error } = await supabase.from('transactions').insert(transactions)
      if (error) throw error
      insertedCount = transactions.length

    } else if (datasetType === 'crm') {
      // Map CSV columns to crm_deals table
      const deals = jsonData.map((row: any) => ({
        user_id: userId,
        deal_name: row.deal_name || row['Deal Name'] || row.name || 'Unnamed Deal',
        client_name: row.client_name || row['Client Name'] || row.client || '',
        amount: parseFloat(row.amount || row.Amount || row.value || '0'),
        phase: row.phase || row.Phase || row.stage || 'Unknown',
        closing_date: row.closing_date || row['Closing Date'] || row.date || new Date().toISOString()
      }))

      const { error } = await supabase.from('crm_deals').insert(deals)
      if (error) throw error
      insertedCount = deals.length

    } else if (datasetType === 'budget') {
      // Map CSV columns to budgets table
      const budgets = jsonData.map((row: any) => ({
        user_id: userId,
        month: row.month || row.Month || row.period || new Date().toISOString().slice(0, 7),
        category: row.category || row.Category || 'General',
        value: parseFloat(row.value || row.Value || row.amount || '0')
      }))

      const { error } = await supabase.from('budgets').insert(budgets)
      if (error) throw error
      insertedCount = budgets.length
    }

    console.log(`[Ingestion] Successfully inserted ${insertedCount} rows for ${datasetType}`)

    return {
      success: true,
      insertedCount,
      datasetType,
      mode
    }
  } catch (error: any) {
    console.error('[Ingestion] Error:', error)
    return {
      success: false,
      insertedCount: 0,
      datasetType,
      mode,
      error: error.message || 'Ingestion failed'
    }
  }
}

