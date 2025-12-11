import { createClient } from '@/lib/supabase/client'

export type ParsedSheet = {
  fileName: string
  sheetName: string
  columns: string[]
  sampleRows: Record<string, unknown>[]
}

export async function upsertCustomDataset(modelId: string, parsed: ParsedSheet, existingDatasetId?: string) {
  const supabase = createClient()
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error('User not authenticated')

  const payload = {
    user_id: user.id,
    dataset_type: 'uploaded_excel', // default type to satisfy NOT NULL constraint
    dataset_name: parsed.fileName,
    schema_json: parsed.columns?.length ? parsed.columns : [],
    rows_json: parsed.sampleRows?.length ? parsed.sampleRows : [],
    source_meta: { sheetName: parsed.sheetName || 'Unknown Sheet' },
  }

  if (existingDatasetId) {
    const { data, error } = await supabase
      .from('custom_datasets')
      .update(payload)
      .eq('id', existingDatasetId)
      .select('id')
      .single()

    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('custom_datasets')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw error
  return data
}

export async function listCustomDatasets(userId: string) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('custom_datasets')
    .select('id, dataset_name, schema_json, rows_json, source_meta, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function deleteCustomDataset(datasetId: string) {
  const supabase = createClient()
  const { error } = await supabase
    .from('custom_datasets')
    .delete()
    .eq('id', datasetId)
  if (error) throw error
}

export async function updateDatasetClassification(id: string, classification: any) {
  const supabase = createClient()
  const { error } = await supabase
    .from('custom_datasets')
    .update({ source_meta: classification })
    .eq('id', id)

  if (error) throw error
}
