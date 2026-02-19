// lib/ai/fitness-studio-insights.ts
// Generate insights for fitness studio reports using AI

const API_PATH = "/api/openai-analyze";

export interface BusinessModelInsights {
  overview?: string[];
  financial?: string[];
  cashflow?: string[];
}

/**
 * Generate insights for fitness studio sections based on KPI data using AI
 */
export async function generateFitnessStudioInsights(
  kpis: any
): Promise<BusinessModelInsights> {
  const insights: BusinessModelInsights = {};

  // Build payload for AI
  const payload = {
    kpis,
    businessModel: "fitness_studio",
  };

  // Generate insights for each section using AI with section-specific prompts
  const sectionPrompts: Record<
    keyof BusinessModelInsights,
    { sys: string; user: string }
  > = {
    overview: {
      sys: `You are a senior FP&A consultant specializing in fitness studio businesses. Write crisp, board-ready bullet points (max 4, max 100 characters each) in neutral tone. Be concise and actionable.`,
      user: `Analyze the OVERVIEW section of a fitness studio report. Focus on HIGH-LEVEL BUSINESS METRICS: active members, member growth/retention trends, class utilization rates, instructor performance, and overall operational health. Provide strategic insights about member base health, retention effectiveness, and capacity utilization. Keep each bullet point under 100 characters. Use this data: ${JSON.stringify(payload)}`,
    },
    financial: {
      sys: `You are a senior FP&A consultant specializing in fitness studio businesses. Write crisp, board-ready bullet points (max 4, max 100 characters each) in neutral tone. Be concise and actionable.`,
      user: `Analyze the FINANCIAL section of a fitness studio report. Focus on REVENUE, COSTS, PROFITABILITY, and MARGINS: total revenue, total costs, net income, gross margins, revenue per member, cost structure efficiency, and profitability trends. Provide insights about financial performance, cost management, and revenue optimization. Keep each bullet point under 100 characters. Use this data: ${JSON.stringify(payload)}`,
    },
    cashflow: {
      sys: `You are a senior FP&A consultant specializing in fitness studio businesses. Write crisp, board-ready bullet points (max 4, max 100 characters each) in neutral tone. Be concise and actionable.`,
      user: `Analyze the CASH FLOW section of a fitness studio report. Focus on LIQUIDITY and CASH MANAGEMENT: net cash flow, burn rate, cash runway, cash balance, cash flow trends, and financial runway. Provide insights about cash position, sustainability, and liquidity management. Keep each bullet point under 100 characters. Use this data: ${JSON.stringify(payload)}`,
    },
  };

  for (const section of Object.keys(sectionPrompts) as Array<
    keyof BusinessModelInsights
  >) {
    try {
      const { sys, user } = sectionPrompts[section];

      console.log(
        `[generateFitnessStudioInsights] Generating ${section} insights...`
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
          `[generateFitnessStudioInsights] Generated ${sectionInsights.length} insights for ${section}`
        );
      } else {
        console.warn(
          `[generateFitnessStudioInsights] No insights generated for ${section}`
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
        `[generateFitnessStudioInsights] Failed to generate ${section} insights:`,
        err
      );
      // Fallback to default message
      insights[section] = ["No material variance detected this period."];
    }
  }

  return insights;
}
