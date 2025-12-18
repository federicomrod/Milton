// app/api/ai/business-model-analyzer/route.ts
// AI-powered business model and KPI generation

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai-client";
import type {
  BusinessModelAnalyzerInput,
  BusinessModelAnalyzerResponse,
  OnboardingAnswers,
  AnalyzerDatasetSample,
  SuggestedKPI,
} from "@/lib/ai/business-model-analyzer-types";
import type { ModelProposal } from "@/lib/model/transform";

// ============================================================================
// ONBOARDING MODE - Generate model from user answers
// ============================================================================

function buildOnboardingSystemPrompt(): string {
  return `You are Milton, an AI data architect and financial advisor for small businesses.

Your task is to analyze the user's business information and generate:
1. A data model (tables, fields, relationships) tailored to their specific business
2. Suggested KPIs they should track

IMPORTANT RULES:
- Make MINIMAL assumptions. Only include tables and fields that are clearly relevant.
- If they mention specific tools (e.g., "Stripe", "Salesforce"), suggest fields that would come from those systems.
- If they mention specific data sources (e.g., "Excel sales sheet"), suggest appropriate table structures.
- Base KPI suggestions on their stated goals and revenue model.
- Keep the model simple - a small business doesn't need 20 tables.

You MUST respond with ONLY valid JSON matching this structure:

{
  "dataModel": {
    "businessType": "string",
    "recommendedTables": [
      {
        "name": "TableName",
        "fields": [
          { "name": "field_name", "type": "string|number|integer|boolean|date", "primaryKey": true|false, "nullable": true|false, "references": { "table": "OtherTable", "field": "field_name" } | null }
        ]
      }
    ],
    "relationships": [
      { "from": "Table.field", "to": "OtherTable.field" }
    ]
  },
  "suggestedKPIs": [
    { "name": "KPI Name", "description": "What this measures", "category": "Revenue|Operations|Customer|Financial|Growth", "formula": "How to calculate (optional)", "priority": "high|medium|low" }
  ]
}

Output ONLY the JSON, no explanations, no markdown.`;
}

function buildOnboardingUserPrompt(answers: OnboardingAnswers): string {
  return `Here is the business information:

BUSINESS TYPE: ${answers.businessTypeLabel || answers.businessType}
TEAM SIZE: ${answers.employees || "Not specified"}
MAIN GOALS: ${answers.goals || "Not specified"}
REVENUE MODEL: ${answers.revenue || "Not specified"}
DATA SOURCES: ${answers.dataSources || "Not specified"}
SYSTEMS/TOOLS: ${answers.systems || "Not specified"}

Based on this:
1. Design a simple, practical data model with only the tables and fields they need.
2. Suggest 5-8 KPIs that align with their goals.
3. Prioritize KPIs based on their stated goals.

Keep it simple for a business with ${answers.employees || "a few"} employees.`;
}

// ============================================================================
// REFINEMENT MODE - Refine model based on uploaded datasets
// ============================================================================

function buildRefinementSystemPrompt(): string {
  return `You are Milton, an AI data architect for small businesses.

Your job is to propose or refine a data model based on uploaded datasets.

You MUST respond with ONLY valid JSON matching this structure:

{
  "dataModel": {
    "businessType": "string",
    "recommendedTables": [
      {
        "name": "TableName",
        "fields": [
          { "name": "field_name", "type": "string|number|integer|boolean|date", "primaryKey": true|false, "nullable": true|false, "references": { "table": "OtherTable", "field": "field_name" } | null }
        ]
      }
    ],
    "relationships": [
      { "from": "Table.field", "to": "OtherTable.field" }
    ]
  }
}

Output ONLY the JSON, no markdown.`;
}

function buildRefinementUserPrompt(
  businessType: string,
  datasets: AnalyzerDatasetSample[],
  currentModel: unknown
): string {
  const parts: string[] = [];
  parts.push(`Business type: "${businessType}"`);
  parts.push(
    "Infer table names, fields, and relationships from the uploaded files.\n"
  );

  if (currentModel) {
    parts.push("Current model (refine, don't discard):");
    parts.push(JSON.stringify(currentModel, null, 2));
  }

  if (datasets.length > 0) {
    parts.push("\nUploaded datasets:");
    for (const ds of datasets) {
      parts.push(`\nDataset: ${ds.sourceName ?? "Unnamed"}`);
      if (ds.tableHint) parts.push(`Table hint: ${ds.tableHint}`);
      parts.push(JSON.stringify(ds.sampleRows.slice(0, 5), null, 2));
    }
  } else {
    parts.push("\nNo datasets provided. Propose a sensible default model.");
  }

  parts.push("\nReturn a ModelProposal JSON with clear, human-readable names.");
  return parts.join("\n");
}

// ============================================================================
// API HANDLER
// ============================================================================

interface AIOnboardingResponse {
  dataModel: ModelProposal;
  suggestedKPIs: SuggestedKPI[];
}

interface AIRefinementResponse {
  dataModel: ModelProposal;
}

export async function POST(req: NextRequest) {
  console.log("[business-model-analyzer] Request received");

  try {
    let body: BusinessModelAnalyzerInput;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }

    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("[business-model-analyzer] Auth failed:", userError);
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Determine mode: onboarding (answers) vs refinement (datasets)
    const isOnboardingMode = !!body.answers;

    console.log(
      "[business-model-analyzer] Mode:",
      isOnboardingMode ? "onboarding" : "refinement"
    );

    let systemPrompt: string;
    let userPrompt: string;

    if (isOnboardingMode) {
      systemPrompt = buildOnboardingSystemPrompt();
      userPrompt = buildOnboardingUserPrompt(body.answers!);
    } else {
      if (!body.businessType) {
        return NextResponse.json(
          { success: false, error: "Missing businessType or answers" },
          { status: 400 }
        );
      }
      systemPrompt = buildRefinementSystemPrompt();
      userPrompt = buildRefinementUserPrompt(
        body.businessType,
        body.datasets || [],
        body.currentModel
      );
    }

    console.log("[business-model-analyzer] Calling OpenAI...");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    console.log("[business-model-analyzer] Response length:", raw.length);

    // Parse response
    let parsed: AIOnboardingResponse | AIRefinementResponse | null = null;
    try {
      const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error("[business-model-analyzer] JSON parse failed:", err);
      console.error("[business-model-analyzer] Raw:", raw);
      return NextResponse.json(
        { success: false, error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    if (!parsed?.dataModel?.recommendedTables) {
      console.error("[business-model-analyzer] Invalid structure:", parsed);
      return NextResponse.json(
        { success: false, error: "Invalid AI response structure" },
        { status: 500 }
      );
    }

    // Set businessType
    const businessType =
      body.answers?.businessType || body.businessType || "general";
    parsed.dataModel.businessType = businessType;

    const tableCount = parsed.dataModel.recommendedTables.length;
    const kpiCount =
      (parsed as AIOnboardingResponse).suggestedKPIs?.length || 0;
    console.log(
      "[business-model-analyzer] Generated:",
      tableCount,
      "tables,",
      kpiCount,
      "KPIs"
    );

    // Save to database (only in onboarding mode)
    if (isOnboardingMode && body.answers) {
      // Get company for user
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("created_by", user.id)
        .single();

      if (company) {
        const { error: saveError } = await supabase
          .from("business_models")
          .upsert(
            {
              company_id: company.id,
              business_type: businessType,
              model_json: parsed.dataModel,
              onboarding_answers: body.answers,
              suggested_kpis:
                (parsed as AIOnboardingResponse).suggestedKPIs || [],
            },
            { onConflict: "company_id" }
          );

        if (saveError) {
          console.error("[business-model-analyzer] Save failed:", saveError);
        } else {
          console.log("[business-model-analyzer] Saved to database");
        }
      }
    }

    const response: BusinessModelAnalyzerResponse = {
      success: true,
      proposal: parsed.dataModel,
      suggestedKPIs: (parsed as AIOnboardingResponse).suggestedKPIs,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error("[business-model-analyzer] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unexpected error",
      },
      { status: 500 }
    );
  }
}
