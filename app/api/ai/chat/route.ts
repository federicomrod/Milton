import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import { handleSemanticMessage } from '@/lib/semantic-query-service'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

type Tx = { date: string; amount: number; category?: string | null }
type Deal = { phase?: string | null; amount?: number | null; closing_date?: string | null; first_appointment?: string | null }
type Budget = { month: string; category?: string | null; value: number }

/**
 * Build a compact textual summary of the user's data for the model.
 * Uses the current schema (user-scoped tables). If you later migrate
 * these to company-scoped tables, adjust the filters accordingly.
 */
async function buildUserDataSummary(supabase: any, userId: string) {
  // Pull small, aggregate-friendly slices
  const [{ data: tx, error: txErr }, { data: deals, error: dealsErr }, { data: budgets, error: budErr }] = await Promise.all([
    supabase.from('transactions').select('date,amount,category').eq('user_id', userId).limit(5000),
    supabase.from('crm_deals').select('phase,amount,closing_date,first_appointment').eq('user_id', userId).limit(5000),
    supabase.from('budgets').select('month,category,value').eq('user_id', userId).limit(5000),
  ])

  // Best-effort resilience
  const txRows: Tx[] = tx ?? []
  const dealRows: Deal[] = deals ?? []
  const budRows: Budget[] = budgets ?? []

  const monthKey = (d?: string | null) => {
    if (!d) return 'unknown'
    // normalize to YYYY-MM
    const iso = d.slice(0, 10)
    const y = iso.slice(0, 4)
    const m = iso.slice(5, 7)
    return `${y}-${m}`
  }

  // Revenue/Expense by month (actuals from transactions)
  const revenueByMonth: Record<string, number> = {}
  const expenseByMonth: Record<string, number> = {}
  for (const t of txRows) {
    const k = monthKey(t.date)
    const amt = Number(t.amount || 0)
    if (amt >= 0) revenueByMonth[k] = (revenueByMonth[k] || 0) + amt
    else expenseByMonth[k] = (expenseByMonth[k] || 0) + Math.abs(amt)
  }

  // Simple category splits (top 5)
  const expenseByCategory: Record<string, number> = {}
  const revenueByCategory: Record<string, number> = {}
  for (const t of txRows) {
    const cat = (t.category || 'Uncategorized').trim()
    const amt = Number(t.amount || 0)
    if (amt >= 0) revenueByCategory[cat] = (revenueByCategory[cat] || 0) + amt
    else expenseByCategory[cat] = (expenseByCategory[cat] || 0) + Math.abs(amt)
  }
  const topN = (obj: Record<string, number>, n = 5) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).reduce((acc, [k, v]) => ({ ...acc, [k]: Math.round(v) }), {} as Record<string, number>)

  // CRM pipeline stats
  const pipelineTotal = dealRows.reduce((s, d) => s + Number(d.amount || 0), 0)
  const openDeals = dealRows.filter(d => !d.closing_date).length
  const dealsByPhase = dealRows.reduce((acc: Record<string, number>, d) => {
    const p = (d.phase || 'Unknown').trim()
    acc[p] = (acc[p] || 0) + 1
    return acc
  }, {})

  // Budget by month (sum positives as revenue budget, negatives as expense budget)
  const budgetRevByMonth: Record<string, number> = {}
  const budgetExpByMonth: Record<string, number> = {}
  for (const b of budRows) {
    // month may be 'Jan 2025', '2025-01', etc. Keep as-is to avoid misparsing.
    const k = (b.month || 'unknown').trim()
    const v = Number(b.value || 0)
    if (v >= 0) budgetRevByMonth[k] = (budgetRevByMonth[k] || 0) + v
    else budgetExpByMonth[k] = (budgetExpByMonth[k] || 0) + Math.abs(v)
  }

  // Trim to ~last 12 keys where possible (keeps prompt small)
  const trimToLastN = (obj: Record<string, number>, n = 12) => {
    const keys = Object.keys(obj).sort()
    const slice = keys.slice(-n)
    const out: Record<string, number> = {}
    for (const k of slice) out[k] = Math.round(obj[k])
    return out
  }

  const summary = [
    `RevenueByMonth: ${JSON.stringify(trimToLastN(revenueByMonth))}`,
    `ExpenseByMonth: ${JSON.stringify(trimToLastN(expenseByMonth))}`,
    `TopExpenseCategories: ${JSON.stringify(topN(expenseByCategory))}`,
    `TopRevenueCategories: ${JSON.stringify(topN(revenueByCategory))}`,
    `PipelineTotal: ${Math.round(pipelineTotal)}`,
    `OpenDeals: ${openDeals}`,
    `DealsByPhase: ${JSON.stringify(dealsByPhase)}`,
    `BudgetRevenueByMonth: ${JSON.stringify(trimToLastN(budgetRevByMonth))}`,
    `BudgetExpenseByMonth: ${JSON.stringify(trimToLastN(budgetExpByMonth))}`,
    `Counts: {transactions:${txRows.length}, deals:${dealRows.length}, budgetRows:${budRows.length}}`,
  ].join('\n')

  return summary
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const supabase = await createClient(cookieStore)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { message } = await req.json().catch(() => ({ message: '' }))
  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Missing "message" in body' }, { status: 400 })
  }

  // If the user message mentions chart or visualization, handle it via semantic service
  if (/\b(chart|graph|plot|compare|trend|visual)\b/i.test(message)) {
    const semanticResult = await handleSemanticMessage(message, user.id)
    return NextResponse.json({
      reply: semanticResult.text,
      chart: semanticResult.chartConfig,
      data: semanticResult.data
    })
  }

  // Build the compact data context
  const dataSummary = await buildUserDataSummary(supabase, user.id).catch(() => 'No data available.')

  const systemPrompt = `
You are Milton, the user's pragmatic finance co-pilot.
Use ONLY the provided "Data Summary" (actuals, budgets, CRM) to answer questions about their business.
If specific data is missing, say it explicitly and suggest which source to upload (transactions, CRM, or budget).
Keep answers concise (≤6 sentences), numeric where possible, and give one actionable suggestion.
`

  const userPrompt = `User question: ${message}\n\nData Summary:\n${dataSummary}`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const reply = completion.choices?.[0]?.message?.content?.trim() || 'I could not generate a response.'
  return NextResponse.json({ reply })
}