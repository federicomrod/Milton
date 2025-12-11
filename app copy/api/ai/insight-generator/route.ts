// app/api/ai/insight-generator/route.ts
import { NextResponse } from 'next/server'
import { openai } from '@/lib/openai-client'

/**
 * AI Insight Generator (Phase 4)
 * Accepts KPI snapshots and returns a short insight summary.
 */
export async function POST(req: Request) {
  try {
    const { kpis } = await req.json()
    if (!kpis || !Array.isArray(kpis)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const prompt = `
    You are Milton, an AI finance assistant.
    Summarize the most relevant KPI trends from this data:
    ${JSON.stringify(kpis, null, 2)}
    Respond in 3–4 short, conversational sentences.
    Avoid repeating numbers already shown in charts.
    Focus on key takeaways and next steps.
    `

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
    })

    const insight = completion.choices?.[0]?.message?.content?.trim() || ''
    return NextResponse.json({ insight })
  } catch (err) {
    console.error('[insight-generator] Error:', err)
    return NextResponse.json({ error: 'Insight generation failed' }, { status: 500 })
  }
}
