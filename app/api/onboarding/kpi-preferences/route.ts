// app/api/onboarding/kpi-preferences/route.ts
// API for saving and loading user's selected KPIs
//
// KPI SOURCE ARCHITECTURE:
// - KPIs from 'kpis' database table (via business_model_templates.kpi_ids)
//   These are standardized KPIs with proper definitions, formulas, and required_data fields.
// - Ranking: AI ranks KPIs based on onboarding_answers, cached in 'ranked_kpi_ids'
//   This prevents repeated AI API calls for the same business model.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai-client";
import type { OnboardingAnswers } from "@/lib/ai/business-model-analyzer-types";
import type { DatabaseKpi } from "@/lib/types/kpi";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Get company for user
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id)
    .single();

  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("business_models")
    .select(
      "selected_kpi_ids, business_type, model_json, onboarding_answers, ranked_kpi_ids"
    )
    .eq("company_id", company.id)
    .single();

  if (error) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const businessType = (data.business_type ?? "general") as string;
  const onboardingAnswers = data.onboarding_answers as OnboardingAnswers | null;

  // NOTE: We ONLY use KPIs from the 'kpis' database table (via business_model_templates.kpi_ids).

  // Fetch KPIs from business model template's kpi_ids
  let recommendedKpis: DatabaseKpi[] = [];
  let additionalKpis: DatabaseKpi[] = [];
  let allKpis: DatabaseKpi[] = [];

  // Normalize business type to try different formats
  // Template keys might be "fitness_studio" or "Fitness Studio" or "fitness-studio"
  const normalizeBusinessType = (type: string): string[] => {
    const variants = [
      type, // Original
      type.toLowerCase().replace(/\s+/g, "_"), // "Fitness Studio" -> "fitness_studio"
      type.toLowerCase().replace(/\s+/g, "-"), // "Fitness Studio" -> "fitness-studio"
      type.toLowerCase(), // "Fitness Studio" -> "fitness studio"
    ];
    // Remove duplicates
    return Array.from(new Set(variants));
  };

  try {
    // Try multiple business type formats
    const businessTypeVariants = normalizeBusinessType(businessType);
    let template = null;

    for (const variant of businessTypeVariants) {
      const { data, error } = await supabase
        .from("business_model_templates")
        .select("kpi_ids, key")
        .eq("key", variant)
        .single();

      if (!error && data) {
        template = data;
        console.log(`[kpi-preferences] Found template with key: ${variant}`);
        break;
      }
    }

    if (!template) {
      console.warn(
        `[kpi-preferences] No template found for business type: ${businessType} (tried: ${businessTypeVariants.join(", ")})`
      );
    }

    if (template && template.kpi_ids && Array.isArray(template.kpi_ids)) {
      const kpiIds = template.kpi_ids as string[];

      if (kpiIds.length > 0) {
        // Fetch KPIs from kpis table
        const { data: kpis, error: kpisError } = await supabase
          .from("kpis")
          .select("*")
          .in("id", kpiIds);

        if (kpisError) {
          console.error(`[kpi-preferences] Error fetching KPIs:`, kpisError);
        }

        if (kpis && kpis.length > 0) {
          allKpis = kpis as DatabaseKpi[];
          console.log(
            `[kpi-preferences] Fetched ${kpis.length} KPIs from database`
          );

          // Rank KPIs if onboarding answers exist
          // Check if we already have ranked KPI IDs cached in the database.
          // This prevents calling the AI ranking API on every request.
          const existingRankedKpiIds = (data as any).ranked_kpi_ids as
            | string[]
            | null
            | undefined;

          if (
            onboardingAnswers &&
            kpis &&
            (!existingRankedKpiIds || existingRankedKpiIds.length === 0)
          ) {
            // Only call AI if we don't have cached rankings
            try {
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
                rankedKpiIds =
                  parsed.rankedKpiIds || parsed.ranked_kpi_ids || [];
              } catch (err) {
                console.error(
                  "[kpi-preferences] Failed to parse AI response:",
                  err
                );
                rankedKpiIds = kpiIds;
              }

              // If AI didn't return valid rankings, use original order
              if (!Array.isArray(rankedKpiIds) || rankedKpiIds.length === 0) {
                rankedKpiIds = kpiIds;
              }

              // Filter to only include IDs that exist in our KPIs
              const validRankedIds = rankedKpiIds.filter(
                (id) => kpis?.some((kpi) => kpi.id === id) ?? false
              );

              // Add any missing KPIs to the end
              const remainingIds = kpiIds.filter(
                (id) => !validRankedIds.includes(id)
              );
              const finalRankedIds = [...validRankedIds, ...remainingIds];

              // Save ranked KPI IDs to database for caching (prevents repeated AI calls)
              // Note: This requires the ranked_kpi_ids column to exist in business_models table
              try {
                const { error: updateError } = await supabase
                  .from("business_models")
                  .update({ ranked_kpi_ids: finalRankedIds })
                  .eq("company_id", company.id);

                if (updateError) {
                  // Gracefully handle if column doesn't exist yet
                  console.warn(
                    "[kpi-preferences] Failed to save ranked_kpi_ids (column may not exist):",
                    updateError
                  );
                } else {
                  console.log(
                    "[kpi-preferences] Saved ranked KPI IDs to database for caching"
                  );
                }
              } catch (saveErr) {
                console.warn(
                  "[kpi-preferences] Error saving ranked_kpi_ids:",
                  saveErr
                );
              }

              // Create a map of KPIs by ID
              const kpiMap = new Map((kpis || []).map((kpi) => [kpi.id, kpi]));

              // Split into recommended (top 6) and additional (rest)
              const recommendedIds = finalRankedIds.slice(0, 6);
              const additionalIds = finalRankedIds.slice(6);

              recommendedKpis = recommendedIds
                .map((id) => kpiMap.get(id))
                .filter((kpi): kpi is DatabaseKpi => kpi !== undefined);
              additionalKpis = additionalIds
                .map((id) => kpiMap.get(id))
                .filter((kpi): kpi is DatabaseKpi => kpi !== undefined);
            } catch (rankError) {
              console.error("[kpi-preferences] Ranking error:", rankError);
              // Fallback: use all KPIs as additional
              if (kpis) {
                additionalKpis = kpis as DatabaseKpi[];
              }
            }
          } else if (existingRankedKpiIds && kpis && kpis.length > 0) {
            // Use cached ranked KPI IDs
            const kpiMap = new Map(kpis.map((kpi) => [kpi.id, kpi]));

            // Split into recommended (top 6) and additional (rest)
            const recommendedIds = existingRankedKpiIds.slice(0, 6);
            const additionalIds = existingRankedKpiIds.slice(6);

            recommendedKpis = recommendedIds
              .map((id) => kpiMap.get(id))
              .filter((kpi): kpi is DatabaseKpi => kpi !== undefined);
            additionalKpis = additionalIds
              .map((id) => kpiMap.get(id))
              .filter((kpi): kpi is DatabaseKpi => kpi !== undefined);
          } else {
            // No onboarding answers or cached rankings, return all KPIs as additional
            if (kpis) {
              additionalKpis = kpis as DatabaseKpi[];
            }
          }

          // Ensure we have KPIs in at least one category
          if (recommendedKpis.length === 0 && additionalKpis.length === 0) {
            console.warn(
              "[kpi-preferences] No KPIs in recommended or additional, using all as additional"
            );
            additionalKpis = allKpis;
          }
        } else {
          console.warn(
            `[kpi-preferences] No KPIs found for IDs:`,
            kpiIds.slice(0, 5),
            "..."
          );
        }
      }
    }
  } catch (err) {
    console.error("[kpi-preferences] Error fetching template KPIs:", err);
    if (err instanceof Error) {
      console.error("[kpi-preferences] Error details:", err.message, err.stack);
    }
  }

  console.log(
    `[kpi-preferences] Returning: ${recommendedKpis.length} recommended, ${additionalKpis.length} additional, ${recommendedKpis.length + additionalKpis.length} total`
  );

  return NextResponse.json({
    selectedKpiIds: (data.selected_kpi_ids ?? []) as string[],
    businessType,
    modelJson: data.model_json ?? null,
    recommendedKpis,
    additionalKpis,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const selectedKpiIds = Array.isArray(body?.selectedKpiIds)
    ? (body.selectedKpiIds as string[])
    : [];

  // Get company for user
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id)
    .single();

  if (!company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("business_models")
    .update({ selected_kpi_ids: selectedKpiIds })
    .eq("company_id", company.id);

  if (error) {
    console.error("[kpi-preferences] update error", error);
    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
