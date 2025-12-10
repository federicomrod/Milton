export async function generateBusinessModel(description: string) {
    try {
      const res = await fetch('/api/ai/business-model-analyzer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessDescription: description }),
      })
  
      if (!res.ok) {
        throw new Error(`Model generation failed: ${res.status}`)
      }
  
      const json = await res.json()
      console.log('✅ Business model generated:', json)
      return json
    } catch (error) {
      console.error('Error generating business model:', error)
      throw error
    }
  }