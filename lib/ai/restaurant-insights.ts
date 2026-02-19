// lib/ai/restaurant-insights.ts
// Generate insights for restaurant reports using AI

const API_PATH = "/api/openai-analyze";

export interface BusinessModelInsights {
  overview?: string[];
  financial?: string[];
  cashflow?: string[];
  operations?: string[];
}

/**
 * Generate insights for restaurant sections based on KPI data using AI
 */
export async function generateRestaurantInsights(
  kpis: any
): Promise<BusinessModelInsights> {
  const insights: BusinessModelInsights = {};

  // Build payload for AI
  const payload = {
    kpis,
    businessModel: "restaurant",
  };

  // Generate insights for each section using AI with section-specific prompts
  const sectionPrompts: Record<
    keyof BusinessModelInsights,
    { sys: string; user: string }
  > = {
    overview: {
      sys: `You are a senior FP&A consultant specializing in restaurant businesses. Write crisp, board-ready bullet points (max 4, max 100 characters each) in neutral tone. Be concise and actionable.`,
      user: `Analyze the OVERVIEW section of a restaurant report. Focus on HIGH-LEVEL OPERATIONAL METRICS: total covers, average ticket size, revenue per cover, prime cost percentage, customer traffic trends, and overall operational performance. Provide strategic insights about customer volume, pricing effectiveness, and operational efficiency. Keep each bullet point under 100 characters. Use this data: ${JSON.stringify(payload)}`,
    },
    financial: {
      sys: `You are a senior FP&A consultant specializing in restaurant businesses. Write crisp, board-ready bullet points (max 4, max 100 characters each) in neutral tone. Be concise and actionable.`,
      user: `Analyze the FINANCIAL section of a restaurant report. Focus on REVENUE, COSTS, and PROFITABILITY: total revenue, food costs (COGS), labor costs, prime cost, gross margins, cost percentages, and profitability metrics. Provide insights about cost control, menu profitability, labor efficiency, and financial performance. Keep each bullet point under 100 characters. Use this data: ${JSON.stringify(payload)}`,
    },
    cashflow: {
      sys: `You are a senior FP&A consultant specializing in restaurant businesses. Write crisp, board-ready bullet points (max 4, max 100 characters each) in neutral tone. Be concise and actionable.`,
      user: `Analyze the CASH FLOW section of a restaurant report. Focus on LIQUIDITY and CASH MANAGEMENT: net cash flow, burn rate, cash runway, cash balance, cash flow trends, and financial sustainability. Provide insights about cash position, operational cash needs, and liquidity management. Keep each bullet point under 100 characters. Use this data: ${JSON.stringify(payload)}`,
    },
    operations: {
      sys: `You are a senior FP&A consultant specializing in restaurant businesses. Write crisp, board-ready bullet points (max 4, max 100 characters each) in neutral tone. Be concise and actionable.`,
      user: `Analyze the OPERATIONS section of a restaurant report. Focus on OPERATIONAL EFFICIENCY METRICS: table utilization rates, reservation effectiveness, peak hours performance, table turnover, seating efficiency, and operational capacity. Provide insights about operational optimization, capacity management, and service efficiency. Keep each bullet point under 100 characters. Use this data: ${JSON.stringify(payload)}`,
    },
  };

  for (const section of Object.keys(sectionPrompts) as Array<
    keyof BusinessModelInsights
  >) {
    try {
      const { sys, user } = sectionPrompts[section];

      console.log(
        `[generateRestaurantInsights] Generating ${section} insights...`
      );

      const res = await fetch(API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          model: "gpt-4o-mini",
        }),
      });

      if (!res.ok) throw new Error(`Route returned ${res.status}`);
      const responseData = await res.json();
      const text =
        responseData?.content ||
        responseData?.result ||
        responseData?.choices?.[0]?.message?.content ||
        "";

      const sectionInsights = text
        .split("\n")
        .map((line: string) => line.replace(/^[-•\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 4);

      if (sectionInsights.length > 0) {
        insights[section] = sectionInsights;
        console.log(
          `[generateRestaurantInsights] Generated ${sectionInsights.length} insights for ${section}`
        );
      } else {
        console.warn(
          `[generateRestaurantInsights] No insights generated for ${section}`
        );
        insights[section] = ["No material variance detected this period."];
      }

      // Small delay between API calls to avoid rate limiting (except for last section)
      const sections = Object.keys(sectionPrompts) as Array<
        keyof BusinessModelInsights
      >;
      const isLastSection = section === sections[sections.length - 1];
      if (!isLastSection) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.warn(
        `[generateRestaurantInsights] Failed to generate ${section} insights:`,
        err
      );
      // Fallback to default message
      insights[section] = ["No material variance detected this period."];
    }
  }

  return insights;
}
