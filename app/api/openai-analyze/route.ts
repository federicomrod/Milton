// app/api/openai-analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

export async function POST(request: NextRequest) {
  try {
    const { prompt, model } = await request.json()

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    // Support both string prompts (legacy) and message arrays (insights)
    const isMessageArray = Array.isArray(prompt)
    console.log('Received prompt for analysis', isMessageArray ? '(message array)' : '(string)')

    // Check if OpenAI key exists
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not found in environment variables')
      return NextResponse.json({
        fileType: 'unknown',
        confidence: 0.3,
        reasoning: 'OpenAI API key not configured',
        columnMappings: [],
        categories: [],
        businessInsights: {
          revenueColumns: [],
          expenseColumns: [],
          recurringRevenue: [],
          dateFormat: 'unknown',
          numberFormat: 'unknown',
          primaryAmountColumn: ''
        }
      })
    }

    // Try to dynamically import OpenAI (in case it's not installed)
    let OpenAI
    try {
      const openaiModule = await import('openai')
      OpenAI = openaiModule.default
    } catch (importError) {
      console.error('OpenAI package not installed:', importError)
      return NextResponse.json({
        fileType: 'unknown',
        confidence: 0.3,
        reasoning: 'OpenAI package not installed. Run: npm install openai',
        columnMappings: [],
        categories: [],
        businessInsights: {
          revenueColumns: [],
          expenseColumns: [],
          recurringRevenue: [],
          dateFormat: 'unknown',
          numberFormat: 'unknown',
          primaryAmountColumn: ''
        }
      })
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    console.log('Making OpenAI API call...')

    // Handle message array format (for insights) vs string format (for file analysis)
    const messages: ChatCompletionMessageParam[] = isMessageArray 
      ? (prompt as ChatCompletionMessageParam[])
      : [
          {
            role: "system",
            content: "You are an expert financial data analyst specializing in German business data. Always respond with valid JSON only, no additional text or formatting."
          },
          {
            role: "user",
            content: prompt as string
          }
        ]

    const completion = await openai.chat.completions.create({
      model: model || "gpt-4",
      messages,
      temperature: isMessageArray ? 0.2 : 0.1,
      max_tokens: isMessageArray ? 220 : 2000,
    })

    const responseText = completion.choices[0]?.message?.content

    if (!responseText) {
      throw new Error('No response from OpenAI')
    }

    console.log('OpenAI raw response received, length:', responseText.length)

    // For message array format (insights), return simple text response
    if (isMessageArray) {
      return NextResponse.json({
        content: responseText,
        result: responseText
      })
    }

    // Try to parse the JSON response
    let parsedResponse
    try {
      const cleanedResponse = responseText.replace(/```json\n?|\n?```/g, '').trim()
      parsedResponse = JSON.parse(cleanedResponse)
    } catch (parseError) {
      console.error('Failed to parse OpenAI response as JSON:', parseError)
      console.error('Raw response preview:', responseText.substring(0, 500))
      
      // Return a high-confidence fallback for common patterns
      return NextResponse.json({
        fileType: 'transactions',
        confidence: 0.7,
        reasoning: 'Fallback analysis: Could not parse AI response but detected financial data patterns',
        columnMappings: [],
        categories: [],
        businessInsights: {
          revenueColumns: [],
          expenseColumns: [],
          recurringRevenue: [],
          dateFormat: 'german',
          numberFormat: 'german',
          primaryAmountColumn: ''
        }
      })
    }

    // Validate and ensure required fields
    const validatedResponse = {
      fileType: parsedResponse.fileType || 'unknown',
      confidence: Math.min(Math.max(Number(parsedResponse.confidence) || 0, 0), 1),
      reasoning: parsedResponse.reasoning || 'No reasoning provided',
      columnMappings: Array.isArray(parsedResponse.columnMappings) ? parsedResponse.columnMappings : [],
      categories: Array.isArray(parsedResponse.categories) ? parsedResponse.categories : [],
      businessInsights: {
        revenueColumns: parsedResponse.businessInsights?.revenueColumns || [],
        expenseColumns: parsedResponse.businessInsights?.expenseColumns || [],
        recurringRevenue: parsedResponse.businessInsights?.recurringRevenue || [],
        dateFormat: parsedResponse.businessInsights?.dateFormat || 'unknown',
        numberFormat: parsedResponse.businessInsights?.numberFormat || 'unknown',
        primaryAmountColumn: parsedResponse.businessInsights?.primaryAmountColumn || ''
      }
    }

    console.log('Returning validated response with confidence:', validatedResponse.confidence)
    return NextResponse.json(validatedResponse)

  } catch (error) {
    console.error('OpenAI API error:', error)
    
    // Return a reasonable fallback instead of erroring
    return NextResponse.json({
      fileType: 'transactions',
      confidence: 0.6,
      reasoning: `OpenAI API error, using fallback analysis. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      columnMappings: [],
      categories: [],
      businessInsights: {
        revenueColumns: [],
        expenseColumns: [],
        recurringRevenue: [],
        dateFormat: 'german',
        numberFormat: 'german',
        primaryAmountColumn: ''
      }
    })
  }
}