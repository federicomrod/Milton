import { streamText, convertToCoreMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildDashboardContextForUser } from "@/lib/ai/dashboard-context";
import {
  resolveDateRange,
  getDefaultReportPeriod,
} from "@/lib/utils/date-range";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export interface ChatSettings {
  responseLength: "concise" | "balanced" | "detailed";
  tone: "friendly" | "formal" | "direct";
}

const DEFAULT_SETTINGS: ChatSettings = {
  responseLength: "concise",
  tone: "direct",
};

function buildResponseStyle(settings: ChatSettings): string[] {
  const lengthInstructions: Record<ChatSettings["responseLength"], string[]> = {
    concise: [
      "Response Style (CONCISE mode):",
      "- Answer the question directly in the first sentence or bullet.",
      "- Keep responses to 2–5 lines or a short bullet list. No preamble.",
      "- Only add context or caveats if they materially change the answer.",
      "- Prefer numbers and specifics over prose.",
    ],
    balanced: [
      "Response Style (BALANCED mode):",
      "- Lead with the direct answer, then add 1–2 sentences of context.",
      "- Use bullet points for lists of 3+ items.",
      "- Include one actionable recommendation when relevant.",
      "- Keep responses under ~150 words unless the question demands more.",
    ],
    detailed: [
      "Response Style (DETAILED mode):",
      "- Provide a comprehensive answer with full context and analysis.",
      "- Use sections, bullet points, and **bold** text to structure the response.",
      "- Include actionable recommendations and connect related data points.",
      "- Explain what KPIs mean and why they matter when relevant.",
    ],
  };

  const toneInstructions: Record<ChatSettings["tone"], string> = {
    friendly:
      "Tone: Warm and encouraging. Celebrate wins, frame issues constructively.",
    formal:
      "Tone: Professional and formal. Avoid contractions and casual language.",
    direct:
      "Tone: Direct and no-nonsense. Skip pleasantries and get straight to the point.",
  };

  return [
    ...lengthInstructions[settings.responseLength],
    toneInstructions[settings.tone],
  ];
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const supabase = await createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const {
    messages,
    settings,
    dateRange: clientDateRange,
    dashboardKpis: clientDashboardKpis,
  }: {
    messages: UIMessage[];
    settings?: Partial<ChatSettings>;
    dateRange?: {
      period: string;
      customDateRange?: { from: string; to: string };
    };
    dashboardKpis?: Array<{
      name: string;
      value: number | null;
      unit?: string;
    }>;
  } = await req.json();

  const chatSettings: ChatSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
  };

  // Get company and business model for context
  let businessTypeLabel = "";
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", user.id)
    .single();

  if (company) {
    const { data: modelRow } = await supabase
      .from("business_models")
      .select("business_type")
      .eq("company_id", company.id)
      .single();

    if (modelRow?.business_type) {
      businessTypeLabel = modelRow.business_type;
    }
  }

  // Get the last user message - UIMessage has parts array or content string
  const lastMessage = messages[messages.length - 1];
  let userMessage = "";
  if (lastMessage) {
    if ("parts" in lastMessage && Array.isArray(lastMessage.parts)) {
      userMessage = lastMessage.parts
        .filter((part: { type: string; text?: string }) => part.type === "text")
        .map((part: { type: string; text?: string }) => part.text || "")
        .join("");
    } else if (
      "content" in lastMessage &&
      typeof lastMessage.content === "string"
    ) {
      userMessage = lastMessage.content;
    }
  }

  // If the user message mentions chart or visualization, handle it via semantic service
  if (/\b(chart|graph|plot|compare|trend|visual)\b/i.test(userMessage)) {
    const result = streamText({
      model: openai("gpt-4o-mini"),
      messages: convertToCoreMessages(messages),
    });
    return result.toUIMessageStreamResponse();
  }

  // Resolve date range from client (dashboard date picker) so Milton sees same values
  const resolvedRange =
    clientDateRange?.period && clientDateRange?.customDateRange
      ? resolveDateRange(
          clientDateRange.period as "month" | "year" | "ytd" | "custom",
          clientDateRange.customDateRange
        )
      : getDefaultReportPeriod();

  const reportPeriod = {
    start: resolvedRange.fromDate,
    end: resolvedRange.toDate,
  };

  // Use unified calculation layer (same APIs as dashboard) when we have date range
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : new URL(req.url).origin;
  const cookieHeader = req.headers.get("cookie");

  const dashboardContext = await buildDashboardContextForUser(
    user.id,
    supabase,
    {
      reportPeriod,
      kpiCalculation: cookieHeader ? { cookieHeader, baseUrl } : undefined,
    }
  );

  const businessInstruction = businessTypeLabel
    ? `The user's business type is: ${businessTypeLabel}. Tailor your insights to this context.`
    : "Provide general business insights based on the available data.";

  const periodForNote = dashboardContext.reportPeriod ?? reportPeriod;
  const dateRangeNote = periodForNote
    ? `\nThe KPI values in the JSON are filtered to the period ${periodForNote.start} to ${periodForNote.end} (the date range the user has selected on the dashboard). When citing numbers, reference this period.\n`
    : "";

  // When client sends KPI name+value from dashboard cards, inject as primary context so AI uses exact numbers
  const dashboardKpisContext =
    clientDashboardKpis &&
    Array.isArray(clientDashboardKpis) &&
    clientDashboardKpis.length > 0
      ? `\n**CURRENT DASHBOARD KPI VALUES (use these exact numbers when answering):**\n${clientDashboardKpis
          .filter((k) => k.value != null && !Number.isNaN(k.value))
          .map((k) => {
            const unit = (k.unit || "").trim();
            const formatted =
              typeof k.value === "number"
                ? k.value.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : String(k.value);
            return `- ${k.name}: ${unit}${formatted}`.trim();
          })
          .join("\n")}\n`
      : "";

  const systemPrompt = [
    "You are Milton, an AI business analyst for small businesses. You give concise, data-driven answers.",
    businessInstruction,
    dashboardKpisContext,
    dateRangeNote,
    "You have access to the following structured data about the user's business in JSON form:",
    "JSON_START",
    JSON.stringify(dashboardContext, null, 2),
    "JSON_END",
    "",
    ...buildResponseStyle(chatSettings),
    "",
    "Data Rules:",
    "- ALWAYS check the dataAvailability flags in the JSON data first.",
    "- If hasTransactions is true, you HAVE transaction data available. Even if revenue/expenses KPIs show 0, you can still provide insights about the transaction data.",
    "- If hasCrmDeals is true, you HAVE CRM deal data. Use the pipelineValue and openDeals KPIs.",
    "- If hasBudgets is true, you HAVE budget data available.",
    "- IMPORTANT: The system supports flexible business model templates. If 'businessModelTemplate' exists in the JSON, the user's business uses a custom data model structure.",
    "- If 'businessModelTemplate' is present, check 'dataAvailability.modelTables' to see what tables are available and their record counts.",
    "- CRITICAL: If 'modelTablesData' exists in the JSON, it contains actual data from the model tables. Each table entry includes: 'count' (total records), 'sample' (first 10 records), and 'aggregations' (field-level summaries like status counts, type counts, total amounts).",
    "- When answering questions about specific data (e.g., 'active members', 'revenue by type'), use the 'modelTablesData' object.",
    "- Always check 'modelTablesData[tableName].count' first. If count > 0, the table has data. Then check 'aggregations' for field-level summaries.",
    "- When the user asks about a KPI, first check if there's a KPI in the 'kpis' array with that name. If not, calculate it from 'modelTablesData'.",
    "- If kpis array has items with non-null currentValue, reference those specific KPIs in your response.",
    "- All KPIs in the kpis array are calculated using the exact same logic as the dashboard displays.",
    "- If monthlyRevenue object has keys, you have monthly revenue trends. Use it for trend analysis.",
    "- When data IS available, provide specific insights based on what you see in the JSON.",
    "- ONLY suggest uploading files if ALL dataAvailability flags are false AND all modelTables have count 0 AND kpis array is empty.",
    "- Use ONLY this JSON data when giving numeric answers.",
    "- When displaying currency amounts, use the currency symbol from the 'unit' field (e.g., €, $, £, CHF).",
    "- If the 'insights' array exists and has items, reference these when the user asks about insights or recommendations.",
    "- If the user asks something outside the scope of this data, you can still answer as a helpful business analyst, but don't fabricate KPIs not in the JSON.",
  ].join("\n");

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: systemPrompt,
    messages: convertToCoreMessages(messages),
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse();
}
