// app/api/ai/insight-generator/route.ts
import { NextResponse } from "next/server";
import { openai } from "@/lib/openai-client";

interface Insight {
  title: string;
  description: string;
  category: "positive" | "warning" | "info" | "action";
}

/**
 * AI Insight Generator for Dashboard
 * Generates 4-5 actionable insights based on KPIs and business metrics
 */
export async function POST(req: Request) {
  try {
    const { metrics, businessType, kpis, currency, numberFormat } =
      await req.json();

    if (!metrics && !kpis) {
      return NextResponse.json(
        { error: "Invalid payload: metrics or kpis required" },
        { status: 400 }
      );
    }

    // Get currency symbol
    const currencyCode = currency || "EUR";
    const currencySymbol =
      currencyCode === "EUR"
        ? "€"
        : currencyCode === "USD"
          ? "$"
          : currencyCode === "GBP"
            ? "£"
            : currencyCode === "CHF"
              ? "CHF"
              : currencyCode === "MXN"
                ? "MX$"
                : "€";

    // Determine number format based on preference
    const numFormat = numberFormat || "1,000.00";
    // For USD, default is 1,000.00 (commas), for EUR it could be 1.000,00 (dots) or 1,000.00 (commas)
    const useCommas = numFormat === "1,000.00";
    const thousandsSeparator = useCommas ? "," : ".";
    const decimalSeparator = useCommas ? "." : ",";

    // Format example for the prompt
    const formatExample = useCommas
      ? `${currencySymbol}1,234,567`
      : `${currencySymbol}1.234.567`;

    // Build comprehensive context for AI
    const context = {
      businessType: businessType || "Unknown",
      metrics: metrics || {},
      kpis: kpis || {},
      currency: currencyCode,
      currencySymbol,
      thousandsSeparator,
      decimalSeparator,
      formatExample,
    };

    const systemPrompt = `You are Milton, an expert AI financial advisor and business analyst. Your role is to provide actionable, insightful analysis of business KPIs and financial metrics. You analyze data like a senior CFO would, identifying trends, risks, opportunities, and actionable recommendations.

Focus on universal financial metrics: cash flow, revenue, expenses, profitability, burn rate, and runway. Provide insights that are applicable across all business types.`;

    const userPrompt = `Analyze the following business data and generate 4-5 concise, actionable insights. Each insight should be:
- Specific and data-driven
- Actionable (what should be done)
- Contextual to the business type
- Focused on financial health, cash flow, profitability, and growth opportunities

IMPORTANT: When displaying currency amounts, ALWAYS use ${context.currencySymbol} (${context.currency}) as the currency symbol. Do NOT use dollar signs ($) or other currency symbols. All monetary values should be formatted with ${context.currencySymbol}.

CRITICAL: Always format numbers with thousands separators. Use "${context.thousandsSeparator}" as the thousands separator. Examples:
- ${context.formatExample} (for 1234567)
- ${context.currencySymbol}93${context.thousandsSeparator}600 (for 93600)
- ${context.currencySymbol}1${context.thousandsSeparator}800${context.thousandsSeparator}000 (for 1800000)
Do NOT write numbers without separators (e.g., ${context.currencySymbol}93600 is wrong, write ${context.currencySymbol}93${context.thousandsSeparator}600 instead).

Business Type: ${context.businessType}
Currency: ${context.currency} (${context.currencySymbol})

Focus on financial metrics and KPIs only. Do not reference entity-specific counts (deals, bookings, etc.) unless they are directly relevant to financial performance.

Key Metrics:
${JSON.stringify(context.metrics, null, 2)}

KPIs:
${JSON.stringify(context.kpis, null, 2)}

Generate insights in the following JSON format (return ONLY valid JSON, no markdown):
{
  "insights": [
    {
      "title": "Short, impactful title (max 8 words)",
      "description": "Detailed explanation with specific recommendations (2-3 sentences)",
      "category": "positive" | "warning" | "info" | "action"
    }
  ]
}

Categories:
- "positive": Good news, strengths, achievements
- "warning": Risks, concerns, areas needing attention
- "info": Neutral information, trends, observations
- "action": Specific actions to take, recommendations

Focus on:
1. Cash runway and burn rate analysis
2. Revenue trends and growth opportunities
3. Cost optimization opportunities
4. Financial health indicators
5. Profitability and margin analysis

Provide insights based on the financial metrics and KPIs provided. Focus on actionable financial advice rather than entity-specific details.

Return ONLY the JSON object, no additional text.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const responseText =
      completion.choices?.[0]?.message?.content?.trim() || "{}";

    // Parse JSON response
    let parsedResponse: { insights?: Insight[] };
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (parseError) {
      console.error("[insight-generator] JSON parse error:", parseError);
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(
        /```(?:json)?\s*(\{[\s\S]*\})\s*```/
      );
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error("Failed to parse AI response as JSON");
      }
    }

    const insights = parsedResponse.insights || [];

    // Validate and limit to 5 insights
    const validInsights = insights
      .slice(0, 5)
      .filter(
        (insight: any) =>
          insight.title &&
          insight.description &&
          ["positive", "warning", "info", "action"].includes(insight.category)
      ) as Insight[];

    // If no valid insights, provide fallback
    if (validInsights.length === 0) {
      return NextResponse.json({
        insights: [
          {
            title: "Data Analysis Complete",
            description:
              "Your financial data has been analyzed. Continue uploading data to get more specific insights.",
            category: "info" as const,
          },
        ],
      });
    }

    return NextResponse.json({ insights: validInsights });
  } catch (err) {
    console.error("[insight-generator] Error:", err);
    return NextResponse.json(
      {
        error: "Insight generation failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
