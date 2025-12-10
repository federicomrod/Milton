import { ParsedFile } from './file-parser'

interface ClassificationResult {
  fileType: 'transactions' | 'crm' | 'budget' | 'unknown'
  mapping: Record<string, string>
  confidence: number
}

export async function classifyFileWithAI(parsed: ParsedFile): Promise<ClassificationResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Missing OpenAI API Key')

  const sampleRows = parsed.rows.slice(0, 5)
  const prompt = `Analyze the following table data and determine:
- What type of data this is (e.g. bank transactions, CRM pipeline, budget)?
- Suggest a standard mapping of the fields.
Return JSON with keys: fileType, mapping (object), and confidence (0-1).

Headers: ${JSON.stringify(parsed.headers)}

Sample Rows:
${JSON.stringify(sampleRows, null, 2)}
`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    })
  })

  const json = await response.json()

  try {
    const content = json.choices?.[0]?.message?.content || ''
    const parsedContent = JSON.parse(content)
    return parsedContent as ClassificationResult
  } catch (err) {
    console.warn('Could not parse AI response:', json)
    return { fileType: 'unknown', mapping: {}, confidence: 0 }
  }
}