// app/api/ai/forecast-generator/route.ts
import { NextResponse } from 'next/server'
import { openai } from '@/lib/openai-client'

export async function POST(req: Request) {
  try {
    const { kpis, businessModel } = await req.json()
    const prompt = `
      You are Milton, a financial forecasting assistant.
      The business model is ${businessModel}.
      Based on the following KPIs and recent trends, forecast the next 3 months and highlight key risks and opportunities:
      ${JSON.stringify(kpis, null, 2)}
      Keep your forecast concise (3-4 bullet points).
    `
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    })
    const forecast = completion.choices?.[0]?.message?.content?.trim() || ''
    return NextResponse.json({ forecast })
  } catch (err) {
    console.error('[forecast-generator] Error:', err)
    return NextResponse.json({ error: 'Forecast generation failed' }, { status: 500 })
  }
}
