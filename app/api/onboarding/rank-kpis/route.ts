// app/api/onboarding/rank-kpis/route.ts
// API to rank KPIs from business model template based on onboarding answers

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai-client";
import type { OnboardingAnswers } from "@/lib/ai/business-model-analyzer-types";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { businessTypeKey, onboardingAnswers } = body as {
      businessTypeKey: string;
      onboardingAnswers: OnboardingAnswers;
    };

    if (!businessTypeKey) {
      return NextResponse.json(
        { error: "businessTypeKey is required" },
        { status: 400 }
      );
    }

    // Fetch business model template to get kpi_ids
    const { data: template, error: templateError } = await supabase
      .from("business_model_templates")
      .select("kpi_ids")
      .eq("key", businessTypeKey)
      .single();

    if (templateError || !template || !template.kpi_ids) {
      console.error("[rank-kpis] Template error:", templateError);
      return NextResponse.json(
        { error: "template_not_found" },
        { status: 404 }
      );
    }

    const kpiIds = template.kpi_ids as string[];

    if (kpiIds.length === 0) {
      return NextResponse.json({
        recommended: [],
        additional: [],
      });
    }

    // Fetch only published KPIs from kpis table
    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("*")
      .in("id", kpiIds)
      .eq("is_published", true);

    if (kpisError || !kpis) {
      console.error("[rank-kpis] KPIs error:", kpisError);
      return NextResponse.json(
        { error: "failed_to_fetch_kpis" },
        { status: 500 }
      );
    }

    // If no onboarding answers provided, return all KPIs as "additional"
    if (!onboardingAnswers) {
      return NextResponse.json({
        recommended: [],
        additional: kpis,
      });
    }

    // Use AI to rank KPIs based on onboarding answers
    const systemPrompt = `You are Milton, an AI financial advisor for small businesses.

Your task is to rank KPIs by relevance based on the user's business information.

You MUST respond with ONLY valid JSON matching this structure:
{
  "rankedKpiIds": ["kpi-id-1", "kpi-id-2", "kpi-id-3", ...]
}

The rankedKpiIds array should contain KPI IDs ordered from most relevant (top) to least relevant (bottom).
The top 3-6 KPIs should be the most relevant based on their goals, revenue model, and business type.`;

    const userPrompt = `Business Information:
BUSINESS TYPE: ${onboardingAnswers.businessTypeLabel || onboardingAnswers.businessType || "Not specified"}
TEAM SIZE: ${onboardingAnswers.employees || "Not specified"}
MAIN GOALS: ${onboardingAnswers.goals || "Not specified"}
REVENUE MODEL: ${onboardingAnswers.revenue || "Not specified"}
DATA SOURCES: ${onboardingAnswers.dataSources || "Not specified"}
SYSTEMS/TOOLS: ${onboardingAnswers.systems || "Not specified"}

Available KPIs:
${kpis
  .map(
    (kpi) => `- ID: ${kpi.id}, Name: ${kpi.name}, Definition: ${kpi.definition}`
  )
  .join("\n")}

Rank these KPIs by relevance. Return the ranked KPI IDs as a JSON array, with the most relevant KPIs first.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    let rankedKpiIds: string[] = [];

    try {
      const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      rankedKpiIds = parsed.rankedKpiIds || parsed.ranked_kpi_ids || [];
    } catch (err) {
      console.error("[rank-kpis] Failed to parse AI response:", err);
      // Fallback: return KPIs in original order
      rankedKpiIds = kpiIds;
    }

    // If AI didn't return valid rankings, use original order
    if (!Array.isArray(rankedKpiIds) || rankedKpiIds.length === 0) {
      rankedKpiIds = kpiIds;
    }

    // Filter to only include IDs that exist in our published KPIs
    const publishedKpiIds = new Set(kpis.map((kpi) => kpi.id));
    const validRankedIds = rankedKpiIds.filter((id) => publishedKpiIds.has(id));

    // Add any published KPIs not ranked by AI to the end
    const remainingIds = kpis
      .map((kpi) => kpi.id)
      .filter((id) => !validRankedIds.includes(id));
    const finalRankedIds = [...validRankedIds, ...remainingIds];

    // Create a map of KPIs by ID
    const kpiMap = new Map(kpis.map((kpi) => [kpi.id, kpi]));

    // Split into recommended (top 6) and additional (rest)
    const recommendedIds = finalRankedIds.slice(0, 6);
    const additionalIds = finalRankedIds.slice(6);

    const recommended = recommendedIds
      .map((id) => kpiMap.get(id))
      .filter(Boolean);
    const additional = additionalIds
      .map((id) => kpiMap.get(id))
      .filter(Boolean);

    return NextResponse.json({
      recommended,
      additional,
    });
  } catch (err) {
    console.error("[rank-kpis] Error:", err);
    return NextResponse.json(
      {
        error: "unexpected_error",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
