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

  // Fetch company first (required for business model query)
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id)
    .single();

  if (companyError || !company) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 });
  }

  // Get business model (now that we have company)
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
    // Try multiple business type formats in a single query using OR
    const businessTypeVariants = normalizeBusinessType(businessType);
    let template = null;

    // Fetch template and check if we have cached rankings in parallel
    // This allows us to determine if we need AI ranking before fetching KPIs
    const templateQuery = supabase
      .from("business_model_templates")
      .select("kpi_ids, key")
      .in("key", businessTypeVariants);

    const { data: templates, error: templateError } = await templateQuery;

    if (!templateError && templates && templates.length > 0) {
      // Prefer exact match, then try variants in order of preference
      template =
        templates.find((t) => t.key === businessType) ||
        templates.find((t) => t.key === businessTypeVariants[1]) ||
        templates.find((t) => t.key === businessTypeVariants[2]) ||
        templates.find((t) => t.key === businessTypeVariants[3]) ||
        templates[0];
      console.log(`[kpi-preferences] Found template with key: ${template.key}`);
    }

    if (!template) {
      console.warn(
        `[kpi-preferences] No template found for business type: ${businessType} (tried: ${businessTypeVariants.join(", ")})`
      );
    }

    // Check cached rankings from business model (before fetching KPIs)
    const existingRankedKpiIds = (data as any).ranked_kpi_ids as
      | string[]
      | null
      | undefined;

    if (template && template.kpi_ids && Array.isArray(template.kpi_ids)) {
      const kpiIds = template.kpi_ids as string[];

      if (kpiIds.length > 0) {
        // Fetch KPIs from kpis table (single query) - only published ones
        const { data: kpis, error: kpisError } = await supabase
          .from("kpis")
          .select("*")
          .in("id", kpiIds)
          .eq("is_published", true);

        if (kpisError) {
          console.error(`[kpi-preferences] Error fetching KPIs:`, kpisError);
        }

        if (kpis && kpis.length > 0) {
          allKpis = kpis as DatabaseKpi[];
          console.log(
            `[kpi-preferences] Fetched ${kpis.length} KPIs from database`
          );

          // Rank KPIs if onboarding answers exist and we don't have cached rankings
          if (
            onboardingAnswers &&
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

  // selected_kpi_ids can be either:
  // - Old format: string[] (array of KPI IDs)
  // - New format: Array<{id: string, displayType: string}> (array of objects)
  const rawSelected = (data.selected_kpi_ids ?? []) as any[];
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  let selectedKpiIds: string[] = [];
  let kpiDisplayModes: Record<string, any> = {};

  // Handle new format: Array<{id: string, displayTypes: string[]}>
  if (
    rawSelected.length > 0 &&
    typeof rawSelected[0] === "object" &&
    rawSelected[0]?.id
  ) {
    const selections = rawSelected as Array<{
      id: string;
      displayTypes?: string[];
      displayType?: string;
    }>;
    const validSelections = selections.filter(
      (item) =>
        typeof item.id === "string" &&
        uuidLike.test(item.id) &&
        // New format: displayTypes array
        ((Array.isArray(item.displayTypes) &&
          item.displayTypes.every((type) =>
            ["card", "chart"].includes(type)
          )) ||
          // Old format: single displayType string (backward compatibility)
          (typeof item.displayType === "string" &&
            ["card", "chart"].includes(item.displayType)))
    );

    // Extract IDs and build display modes
    selectedKpiIds = validSelections.map((item) => item.id);
    kpiDisplayModes = validSelections.reduce(
      (acc, item) => {
        // Handle both old and new formats
        const displayTypes =
          item.displayTypes ||
          (item.displayType ? [item.displayType] : ["card"]);
        acc[item.id] = displayTypes;
        return acc;
      },
      {} as Record<string, any>
    );
  } else {
    // Handle old format: string[] (backward compatibility)
    const validSelectedKpiIds = rawSelected.filter(
      (id): id is string => typeof id === "string" && uuidLike.test(id)
    );
    selectedKpiIds = validSelectedKpiIds;
  }

  // Filter selected KPIs to only include those that are still published
  if (selectedKpiIds.length > 0) {
    const { data: publishedSelectedKpis } = await supabase
      .from("kpis")
      .select("id")
      .in("id", selectedKpiIds)
      .eq("is_published", true);

    const publishedIds = new Set(
      publishedSelectedKpis?.map((kpi) => kpi.id) ?? []
    );

    // Filter both IDs and display modes
    selectedKpiIds = selectedKpiIds.filter((id) => publishedIds.has(id));
    kpiDisplayModes = Object.fromEntries(
      Object.entries(kpiDisplayModes).filter(([id]) => publishedIds.has(id))
    );

    // Clean up the business model if there are draft KPIs that were previously selected
    const originalCount = rawSelected.length;
    if (selectedKpiIds.length !== originalCount) {
      console.log(
        `[kpi-preferences] Cleaning up ${originalCount - selectedKpiIds.length} draft KPIs from selected_kpi_ids`
      );
      try {
        // Convert back to new format for storage
        const cleanedSelections = selectedKpiIds.map((id) => ({
          id,
          displayTypes: kpiDisplayModes[id] || ["card"],
        }));

        const { error: updateError } = await supabase
          .from("business_models")
          .update({ selected_kpi_ids: cleanedSelections })
          .eq("company_id", company.id);

        if (updateError) {
          console.warn(
            "[kpi-preferences] Failed to clean up draft KPIs from business model:",
            updateError
          );
        }
      } catch (err) {
        console.warn("[kpi-preferences] Error cleaning up draft KPIs:", err);
      }
    }
  }

  const response = NextResponse.json({
    selectedKpiIds,
    kpiDisplayModes,
    businessType,
    modelJson: data.model_json ?? null,
    recommendedKpis,
    additionalKpis,
  });

  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");

  return response;
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

  // New format: selectedKpiIds is Array<{id: string, displayTypes: string[]}>
  const raw = Array.isArray(body?.selectedKpiIds)
    ? (body.selectedKpiIds as Array<{ id: string; displayTypes: string[] }>)
    : [];

  // Validate format and extract valid KPI IDs
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const validKpiSelections = raw.filter(
    (item): item is { id: string; displayTypes: string[] } =>
      typeof item === "object" &&
      item !== null &&
      typeof item.id === "string" &&
      Array.isArray(item.displayTypes) &&
      uuidLike.test(item.id) &&
      item.displayTypes.every((type) => ["card", "chart"].includes(type))
  );

  // Extract just the IDs for validation against published KPIs
  const kpiIds = validKpiSelections.map((item) => item.id);

  // Validate that all selected KPIs are published
  let validSelections: Array<{ id: string; displayTypes: string[] }> = [];
  if (kpiIds.length > 0) {
    const { data: publishedKpis } = await supabase
      .from("kpis")
      .select("id")
      .in("id", kpiIds)
      .eq("is_published", true);

    const publishedKpiIds = new Set(publishedKpis?.map((kpi) => kpi.id) ?? []);

    // Filter selections to only include published KPIs
    validSelections = validKpiSelections.filter((selection) =>
      publishedKpiIds.has(selection.id)
    );

    // Log if any draft KPIs were filtered out
    if (validSelections.length !== validKpiSelections.length) {
      console.log(
        `[kpi-preferences] Filtered out ${validKpiSelections.length - validSelections.length} draft KPIs from selection`
      );
    }
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

  // Store the combined format directly
  const { error } = await supabase
    .from("business_models")
    .update({ selected_kpi_ids: validSelections })
    .eq("company_id", company.id);

  if (error) {
    console.error("[kpi-preferences] update error", error);
    return NextResponse.json({ error: "failed_to_update" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
