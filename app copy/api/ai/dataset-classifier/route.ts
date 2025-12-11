import { NextResponse } from 'next/server'
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({} as any))
    const datasetName = typeof payload?.datasetName === 'string' ? payload.datasetName : 'Unknown Dataset'
    const columns = Array.isArray(payload?.columns) ? payload.columns : []
    const sampleRows = Array.isArray(payload?.sampleRows) ? payload.sampleRows : []
    const businessContext = typeof payload?.businessContext === 'string' ? payload.businessContext : 'Unknown'

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        detectedTable: 'unknown',
        confidence: 0,
        suggestedLinks: [],
        notes: 'OpenAI key missing; returned safe fallback.'
      })
    }

    const systemPrompt = `
You are Milton, an AI data analyst specialized in financial and operational datasets.
Your task is to classify the purpose of a dataset and suggest its relationships.
Always respond in structured JSON only.
Return keys: detectedTable, confidence (0–1), suggestedLinks (array), and notes.
`

    const userPrompt = `
Business context: ${businessContext || 'Unknown'}
Dataset name: ${datasetName}
Columns: ${columns.join(', ')}
Sample rows (first 3):
${JSON.stringify(sampleRows.slice(0, 3), null, 2)}
`

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })

    const rawContent = completion?.choices?.[0]?.message?.content ?? '{}'
    const cleanedContent = rawContent
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim()

    let result: Record<string, unknown>
    try {
      result = JSON.parse(cleanedContent)
    } catch (parseErr) {
      console.error('Failed to parse classifier output:', rawContent, parseErr)
      result = { detectedTable: 'unknown', confidence: 0, suggestedLinks: [], notes: 'Invalid JSON from AI; used fallback.' }
    }

    return NextResponse.json(result ?? {})
  } catch (err) {
    console.error('Dataset classification error:', err)
    return NextResponse.json({
      detectedTable: 'unknown',
      confidence: 0,
      suggestedLinks: [],
      notes: 'Classifier route caught an error; returned fallback.'
    })
  }
}
