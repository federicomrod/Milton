

import { NextResponse } from 'next/server'
import { handleSemanticMessage } from '@/lib/semantic-query-service'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const message = body?.message || body?.query || ''
    if (!message) {
      return NextResponse.json({ error: 'Missing query message' }, { status: 400 })
    }

    // Call the semantic query service
    const result = await handleSemanticMessage(message)

    // Return a mock chart config with the semantic result
    return NextResponse.json({
      ok: true,
      message: result.text,
      chart: result.chartConfig,
      data: result.data
    })
  } catch (err: any) {
    console.error('Error in /api/charts/generate:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate chart' },
      { status: 500 }
    )
  }
}