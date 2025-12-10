
import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import type { ModelProposal } from '@/lib/model/transform'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { businessDescription, uploadedFiles } = body

    if (!businessDescription) {
      return NextResponse.json({ error: 'Missing business description' }, { status: 400 })
    }

    const prompt = `
You are an expert data architect helping design startup financial data models.
The company is described as: "${businessDescription}"
They have uploaded these files: ${JSON.stringify(uploadedFiles || [], null, 2)}

Propose a normalized relational data model for Supabase. Return JSON with:
{
  "businessType": string,
  "recommendedTables": [
    { "name": string, "fields": string[] }
  ],
  "relationships": [
    { "from": string, "to": string }
  ],
  "notes": string
}
Only output valid JSON, no explanations.
`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a data architect for a SaaS financial platform.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    })

    const text = completion.choices[0].message?.content || '{}'
    console.log('AI raw output:', text)
    
    let parsed: any = {}
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      console.error('Failed to parse AI output:', err)
    }

    const proposal: ModelProposal = {
      businessType: parsed.businessType ?? 'Unknown Business',
      recommendedTables: Array.isArray(parsed.recommendedTables)
        ? parsed.recommendedTables.map((t: any) => ({
            name: t.name ?? 'Table',
            fields: Array.isArray(t.fields)
              ? t.fields.map((f: any) =>
                  typeof f === 'string'
                    ? { name: f, type: 'string' }
                    : { name: f.name ?? 'field', type: f.type ?? 'string' }
                )
              : [],
          }))
        : [],
      relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      meta: {
        notes: parsed.notes ?? '',
      },
    }

    return NextResponse.json(proposal)
  } catch (err: any) {
    console.error('Error in business-model-analyzer:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}