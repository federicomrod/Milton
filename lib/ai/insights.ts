// lib/ai/insights.ts
import type { ReportData } from '@/lib/report-data-service'

const API_PATH = '/api/openai-analyze'

export type InsightSection = 'overview' | 'financial' | 'pipeline' | 'cashflow'
export type Insights = Partial<Record<InsightSection, string[]>>

export async function generateInsights(data: ReportData, section: InsightSection): Promise<string[]> {
  // Build a compact, structured summary payload
  const payload = {
    kpis: data.kpis,
    budgetVariance: data.budgetVariance?.slice(0, 10) ?? [],
  }

  try {
    const sys = `You are a senior FP&A consultant. Write crisp, board-ready bullet points (max 4) in neutral tone.`
    const user = `Create concise insights for section "${section}" using this data: ${JSON.stringify(payload)}`
    
    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        model: 'gpt-4o-mini'
      }),
    })

    if (!res.ok) throw new Error(`Route returned ${res.status}`)
    const responseData = await res.json()
    const text = responseData?.content || responseData?.result || responseData?.choices?.[0]?.message?.content || ''
    
    return text
      .split('\n')
      .map((line: string) => line.replace(/^[-•\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 4)
  } catch (err) {
    console.warn('Insight generation failed via API route:', err)
    // Fallback if API fails
    const k = data.kpis || {}
    const defaultLine = 'No material variance detected this period.'
    switch (section) {
      case 'overview':
        return [`Revenue ${fmt(k.revenue)}; expenses ${fmt(k.expenses)}; net income ${fmt(k.netIncome)}.`, defaultLine]
      case 'financial':
        return summarizeVariance(data) || [defaultLine]
      case 'pipeline':
        return [`Pipeline value ${fmt(k.pipelineValue)} across ${k.openDeals ?? 0} open deals.`, defaultLine]
      case 'cashflow':
        return [`Burn rate ${fmt(k.burnRate)} per month; runway ${k.cashRunway ?? 0} months.`, defaultLine]
    }
  }
}

function summarizeVariance(data: ReportData): string[] | null {
  const v = data.budgetVariance ?? []
  if (!v.length) return null
  const rev = v.find(x => /revenue/i.test(x.label))
  const exp = v.find(x => /expense|opex|cost/i.test(x.label))
  const lines: string[] = []
  if (rev) lines.push(`Revenue variance ${fmt(rev.variance)} (${pct(rev.variancePct)}).`)
  if (exp) lines.push(`Expenses variance ${fmt(exp.variance)} (${pct(exp.variancePct)}).`)
  return lines.length ? lines : null
}

function fmt(n: any) {
  if (n == null || isNaN(Number(n))) return '€0'
  return '€ ' + Number(n).toLocaleString('de-DE', { maximumFractionDigits: 0 })
}
function pct(n: any) {
  if (n == null || isNaN(Number(n))) return '0%'
  return Number(n).toFixed(1) + '%'
}
