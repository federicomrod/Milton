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
} from "@/lib/ai/business-model-analyzer-types";
import type { ModelProposal } from "@/lib/model/transform";
import { getDataTablesByIds } from "@/lib/data-table-service";

// ============================================================================
// ONBOARDING MODE - Generate model from user answers
// ============================================================================

function buildOnboardingSystemPrompt(): string {
  return `You are Milton, an AI data architect and financial advisor for small businesses.

Your task is to analyze the user's business information and generate:
1. A data model (tables, fields, relationships) tailored to their specific business

IMPORTANT RULES:
- Make MINIMAL assumptions. Only include tables and fields that are clearly relevant.
- If they mention specific tools (e.g., "Stripe", "Salesforce"), suggest fields that would come from those systems.
- If they mention specific data sources (e.g., "Excel sales sheet"), suggest appropriate table structures.
- Keep the model simple - a small business doesn't need 20 tables.
- KPIs are handled separately via business_model_templates - do not generate KPIs.

You MUST respond with ONLY valid JSON matching this structure:

{
  "dataModel": {
    "businessType": "string",
    "recommendedTables": [
      {
        "name": "TableName",
        "fields": [
          { "name": "field_name", "type": "string|number|integer|boolean|date", "primaryKey": true|false, "nullable": true|false, "references": { "table": "OtherTable", "field": "field_name" } | null, "allowedValues": ["value1","value2"] | null }
        ]
      }
    ],
    "relationships": [
      { "from": "Table.field", "to": "OtherTable.field" }
    ]
  }
}

For string fields that represent a status, category, or any enumerated type, include "allowedValues" with the canonical lowercase English values (e.g. ["active","inactive","cancelled"]). Leave allowedValues null for free-text fields.

Output ONLY the JSON, no explanations, no markdown.`;
}

function buildOnboardingUserPrompt(answers: OnboardingAnswers): string {
  const businessTypeInfo = answers.businessType
    ? `BUSINESS TYPE (USER SELECTED): ${answers.businessTypeLabel || answers.businessType}\nIMPORTANT: The user explicitly selected this business type. Use it as the businessType in your response.`
    : `BUSINESS TYPE: ${answers.businessTypeLabel || "Not specified"}`;

  return `Here is the business information:

${businessTypeInfo}
TEAM SIZE: ${answers.employees || "Not specified"}
MAIN GOALS: ${answers.goals || "Not specified"}
REVENUE MODEL: ${answers.revenue || "Not specified"}
DATA SOURCES: ${answers.dataSources || "Not specified"}
SYSTEMS/TOOLS: ${answers.systems || "Not specified"}

Based on this:
1. Design a simple, practical data model with only the tables and fields they need.
${answers.businessType ? `2. Use "${answers.businessType}" as the businessType in your response.` : ""}

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
          { "name": "field_name", "type": "string|number|integer|boolean|date", "primaryKey": true|false, "nullable": true|false, "references": { "table": "OtherTable", "field": "field_name" } | null, "allowedValues": ["value1","value2"] | null }
        ]
      }
    ],
    "relationships": [
      { "from": "Table.field", "to": "OtherTable.field" }
    ]
  }
}

For string fields that represent a status, category, or any enumerated type, include "allowedValues" with the canonical lowercase English values. Leave allowedValues null for free-text fields.

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
    let parsed: AIOnboardingResponse | AIRefinementResponse | null = null;

    if (isOnboardingMode) {
      // In onboarding mode, use template data instead of AI
      const businessType = body.answers!.businessType;

      if (!businessType) {
        console.error(
          "[business-model-analyzer] No businessType provided in answers:",
          body.answers
        );
        return NextResponse.json(
          {
            success: false,
            error:
              "Missing businessType in answers. Please select a business type.",
          },
          { status: 400 }
        );
      }

      console.log(
        "[business-model-analyzer] Using template for business type:",
        businessType
      );

      // Fetch the business model template
      const { data: template, error: templateError } = await supabase
        .from("business_model_templates")
        .select("required_table_ids, required_relationships")
        .eq("key", businessType)
        .single();

      if (templateError || !template) {
        console.error(
          "[business-model-analyzer] Template fetch error:",
          templateError
        );
        return NextResponse.json(
          {
            success: false,
            error: `Template not found for business type: ${businessType}`,
          },
          { status: 404 }
        );
      }

      // Fetch data tables using new ID-based approach
      let recommendedTables: any[] = [];

      if (
        template.required_table_ids &&
        template.required_table_ids.length > 0
      ) {
        // Fetch tables from centralized data_tables
        const dataTables = await getDataTablesByIds(
          template.required_table_ids
        );
        recommendedTables = dataTables.map((table) => ({
          name: table.name,
          fields: table.fields.map((field) => ({
            name: field.name,
            type: field.type,
            required: field.required,
            primaryKey: field.primaryKey,
            references: field.references,
          })),
        }));
      }

      // Parse relationships (support both old string-based and new ID-based formats)
      const relationships = (template.required_relationships || []).map(
        (rel: any) => ({
          from: rel.from || `${rel.from_table}.${rel.from_field}`,
          to: rel.to || `${rel.to_table}.${rel.to_field}`,
          type: rel.type,
        })
      );

      parsed = {
        dataModel: {
          businessType,
          recommendedTables,
          relationships,
        },
      };

      console.log("[business-model-analyzer] Template model generated:", {
        tables: recommendedTables.length,
        relationships: relationships.length,
      });
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

      // Helper function to strip JSON comments
      const stripJsonComments = (jsonString: string): string => {
        // Remove single-line comments (// ...)
        let cleaned = jsonString.replace(/\/\/.*$/gm, "");
        // Remove multi-line comments (/* ... */)
        cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
        return cleaned;
      };

      // Parse response
      try {
        const cleaned = stripJsonComments(raw)
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
    }

    if (!parsed?.dataModel?.recommendedTables) {
      console.error("[business-model-analyzer] Invalid structure:", parsed);
      return NextResponse.json(
        { success: false, error: "Invalid AI response structure" },
        { status: 500 }
      );
    }

    // Set businessType - prioritize user's explicit selection over AI's interpretation
    // User's selection is more reliable than AI inference
    const userSelectedBusinessType =
      body.answers?.businessType || body.businessType;
    const aiDeterminedBusinessType = parsed.dataModel.businessType;

    const businessType =
      userSelectedBusinessType || aiDeterminedBusinessType || "general";

    console.log("[business-model-analyzer] Business type resolution:", {
      userSelected: userSelectedBusinessType,
      aiDetermined: aiDeterminedBusinessType,
      final: businessType,
    });

    parsed.dataModel.businessType = businessType;

    const tableCount = parsed.dataModel.recommendedTables.length;
    console.log("[business-model-analyzer] Generated:", tableCount, "tables");

    // Save to database (only in onboarding mode)
    if (isOnboardingMode && body.answers) {
      // Get company for user
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .eq("created_by", user.id)
        .single();

      if (company) {
        // Get systems (data readiness) and dataSources from onboarding answers
        const systems = (body.answers as any)?.systems;
        const dataSources = (body.answers as any)?.dataSources;

        // Build data_readiness and data_sources objects - save even if empty
        const dataReadiness = systems ? { systems: String(systems) } : {};
        const dataSourcesObj = dataSources
          ? { sources: String(dataSources) }
          : {};

        // Save business model with canonical_model, data_readiness (systems) and data_sources (dataSources) in the same upsert
        const { error: saveError } = await supabase
          .from("business_models")
          .upsert(
            {
              company_id: company.id,
              business_type: businessType,
              canonical_model: parsed.dataModel,
              model_json: parsed.dataModel, // Keep for backwards compatibility (deprecated)
              onboarding_answers: body.answers,
              data_readiness: dataReadiness,
              data_sources: dataSourcesObj,
            },
            { onConflict: "company_id" }
          );

        if (saveError) {
          console.error("[business-model-analyzer] Save failed:", saveError);
        }
      }
    }

    const response: BusinessModelAnalyzerResponse = {
      success: true,
      proposal: parsed.dataModel,
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
