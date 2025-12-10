// Semantic Query Layer Skeleton for Chatbot and API Integration

export interface SemanticQuery {
  datasetType?: string
  datasetName?: string
  metric?: string
  dimension?: string
  filters?: Record<string, any>
  chartType?: string
}

type ChartPoint = { label: string; value: number }

export interface SemanticResult {
  text: string
  data?: ChartPoint[]
  chartConfig?: any
}

/**
 * Parse a user message into a SemanticQuery structure.
 * Very basic placeholder logic for MVP.
 */
export async function parseUserQuery(message: string): Promise<SemanticQuery> {
  const lower = message.toLowerCase()
  const query: SemanticQuery = {}

  // Expanded keyword mapping
  if (
    lower.includes('revenue') ||
    lower.includes('income') ||
    lower.includes('mrr') ||
    lower.includes('arr')
  ) {
    query.metric = 'revenue'
  }

  if (
    lower.includes('expense') ||
    lower.includes('cost') ||
    lower.includes('cash')
  ) {
    query.metric = 'expenses'
  }

  if (
    lower.includes('pipeline') ||
    lower.includes('deal') ||
    lower.includes('crm')
  ) {
    query.datasetType = 'crm'
  }

  if (lower.includes('cash balance') || lower.includes('balance')) {
    query.metric = 'cash'
  }

  if (lower.includes('booking') || lower.includes('session')) {
    query.datasetType = 'bookings'
  }

  if (lower.includes('evaluation') || lower.includes('coach')) {
    query.datasetType = 'coach_evaluations'
  }

  if (lower.includes('month')) query.dimension = 'month'
  if (lower.includes('week')) query.dimension = 'week'

  return query
}

import { createClient } from '@/lib/supabase/server'

export async function runSemanticQuery(query: SemanticQuery, userId?: string): Promise<SemanticResult> {
  if (!userId) {
    return { text: 'ℹ️ Please sign in to run data queries.', data: [], chartConfig: undefined }
  }

  const supabase = await createClient()
  let data: ChartPoint[] = []
  let text = ''
  let chartType = query.chartType || 'bar'

  try {
    if (query.metric === 'revenue' || query.metric === 'income') {
      // Monthly revenue from transactions
      const { data: rows, error } = await supabase
        .from('transactions')
        .select('amount, date')
        .eq('user_id', userId)
      if (error) throw error

      const monthly = rows.reduce((acc: Record<string, number>, row: any) => {
        if (!row.date) return acc
        const month = new Date(row.date).toISOString().slice(0, 7)
        acc[month] = (acc[month] || 0) + (Number(row.amount) || 0)
        return acc
      }, {})

      data = Object.entries(monthly).map(([label, value]) => ({ label, value }))
      text = `📊 Calculated monthly ${query.metric} based on transactions data.`
    } else if (query.metric === 'expenses' || query.metric === 'cost') {
      // Monthly expenses from budgets
      const { data: rows, error } = await supabase
        .from('budgets')
        .select('category, planned_amount, actual_amount, month')
        .eq('user_id', userId)
      if (error) throw error

      data = rows.map((r: any) => ({
        label: r.month ?? 'unknown',
        value: Number(r.actual_amount || r.planned_amount || 0)
      }))
      text = '📊 Fetched monthly expenses from budget data.'
    } else if (query.datasetType === 'crm' || query.metric === 'pipeline') {
      // CRM pipeline value by month
      const { data: deals, error } = await supabase
        .from('crm_deals')
        .select('value, close_date')
        .eq('user_id', userId)
      if (error) throw error

      const monthly = deals.reduce((acc: Record<string, number>, d: any) => {
        if (!d.close_date) return acc
        const month = new Date(d.close_date).toISOString().slice(0, 7)
        acc[month] = (acc[month] || 0) + (Number(d.value) || 0)
        return acc
      }, {})

      data = Object.entries(monthly).map(([label, value]) => ({ label, value }))
      text = '📊 Aggregated CRM pipeline value per month.'
    } else {
      text = 'ℹ️ No specific metric found — returning empty dataset.'
    }
  } catch (err: any) {
    console.error('Semantic query error:', err)
    text = `❌ Failed to retrieve ${query.metric || query.datasetType || 'data'} data.`
  }

  return {
    text,
    data,
    chartConfig: data.length
      ? {
          type: chartType,
          metric: query.metric,
          dimension: query.dimension,
          dataset: query.datasetType,
          data
        }
      : undefined
  }
}

/**
 * High-level helper for chatbot/API routes.
 */
export async function handleSemanticMessage(message: string, userId?: string): Promise<SemanticResult> {
  const query = await parseUserQuery(message)
  const result = await runSemanticQuery(query, userId)
  return result
}