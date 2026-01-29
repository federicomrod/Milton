import { streamText, convertToCoreMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildDashboardContextForUser } from "@/lib/ai/dashboard-context";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const supabase = await createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

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
    // For semantic queries, we'll return a text response with the chart info
    const result = streamText({
      model: openai("gpt-4o-mini"),
      messages: convertToCoreMessages(messages),
    });
    return result.toUIMessageStreamResponse();
  }

  // Build dashboard context with structured data
  const dashboardContext = await buildDashboardContextForUser(
    user.id,
    supabase
  );

  const businessInstruction = businessTypeLabel
    ? `The user's business type is: ${businessTypeLabel}. Tailor your insights and recommendations to this context.`
    : "Provide general business insights based on the available data.";

  const systemPrompt = [
    "You are Milton, an AI finance copilot for small businesses. You provide detailed, well-structured, and actionable financial insights.",
    businessInstruction,
    "",
    "You have access to the following structured data about the user's business in JSON form:",
    "JSON_START",
    JSON.stringify(dashboardContext, null, 2),
    "JSON_END",
    "",
    "Response Format:",
    "- Use markdown formatting for better readability (bullet points, numbered lists, bold text, etc.)",
    "- Structure your responses with clear sections when appropriate",
    "- Use bullet points (• or -) for lists of insights, recommendations, or key points",
    "- Use numbered lists for step-by-step instructions or ordered recommendations",
    "- Use **bold** for important metrics, KPIs, or key takeaways",
    "- Break up long responses into paragraphs for better readability",
    "",
    "Response Depth:",
    "- Provide comprehensive, in-depth answers that thoroughly address the user's question",
    "- Include context, analysis, and actionable recommendations when relevant",
    "- Don't be overly brief - expand on important points to provide value",
    "- When discussing KPIs or metrics, explain what they mean and why they matter",
    "- Connect different data points to provide holistic insights",
    "",
    "Rules:",
    "- ALWAYS check the dataAvailability flags in the JSON data first.",
    "- If hasTransactions is true, you HAVE transaction data available. Even if revenue/expenses KPIs show 0, you can still provide insights about the transaction data structure, count, and patterns.",
    "- If hasCrmDeals is true, you HAVE CRM deal data. Use the pipelineValue and openDeals KPIs to provide insights.",
    "- If hasBudgets is true, you HAVE budget data available. Use it to provide insights.",
    "- IMPORTANT: The system now supports flexible business model templates. If 'businessModelTemplate' exists in the JSON, the user's business uses a custom data model structure.",
    "- If 'businessModelTemplate' is present, check 'dataAvailability.modelTables' to see what tables are available and their record counts. Each table has fields defined in 'businessModelTemplate.requiredTables'.",
    "- CRITICAL: If 'modelTablesData' exists in the JSON, it contains actual data from the model tables. Each table entry includes: 'count' (total records), 'sample' (first 10 records), and 'aggregations' (field-level summaries like status counts, type counts, total amounts).",
    "- When answering questions about specific data (e.g., 'active members', 'revenue by type'), use the 'modelTablesData' object. For example, if asked about 'active members', check 'modelTablesData.members.aggregations.status.active' to see how many members have status='active'. The status values in aggregations are lowercase (e.g., 'active', 'inactive', 'pending').",
    "- IMPORTANT: Always check 'modelTablesData[tableName].count' first. If count > 0, the table has data. Then check 'aggregations' for field-level summaries. If aggregations don't exist for a field, you can still use the 'sample' data to answer questions.",
    "- When the user asks about a KPI (like 'active members KPI'), first check if there's a KPI in the 'kpis' array with that name. If not, calculate it from 'modelTablesData'. For 'active members', count records in 'modelTablesData.members' where status='active' (check aggregations.status.active or count in sample data).",
    "- The 'sample' array in modelTablesData contains actual record examples. Use these to understand the data structure and provide specific insights.",
    "- When 'businessModelTemplate' exists, the data structure is defined by 'requiredTables' (table names, fields, required fields) and 'relationships' (how tables connect). Use this structure to understand the user's business data.",
    "- The 'dataCategories' in businessModelTemplate show how data is categorized (e.g., revenue, expenses, members, bookings, etc.). Use these categories when discussing data.",
    "- If 'modelTables' in dataAvailability shows tables with counts > 0, those tables have data. Reference specific table names and fields when discussing the data.",
    "- If kpis array has items with non-null currentValue, reference those specific KPIs in your response.",
    "- IMPORTANT: All KPIs in the kpis array are calculated using the exact same logic as the dashboard displays. When the user asks about any metric (MRR, ARR, cash balance, burn rate, gross margin, net margin, customer count, runway, LTM revenue, contracted revenue, etc.), use the corresponding KPI from the kpis array.",
    "- The KPIs include: MRR, ARR, cash_balance, burn_rate, burn_rate_ltm, burn_variance, ltm_revenue, contracted_revenue, gross_margin, net_margin, customer_count, and runway. All values match what's shown in the dashboard.",
    "- If monthlyRevenue object has keys, you have monthly revenue trends. Use it for trend analysis.",
    "- When data IS available (dataAvailability flags are true OR modelTables have counts > 0), provide specific insights based on what you see in the JSON, even if some KPIs are 0.",
    "- ONLY suggest uploading files if ALL dataAvailability flags are false AND (modelTables is empty OR all modelTables have count 0) AND kpis array is empty.",
    "- If transactions exist but revenue is 0, mention that you see transaction data but the amounts may need review, or ask about the transaction structure.",
    "- When discussing flexible model tables, use the actual table names and field names from 'businessModelTemplate.requiredTables'. For example, if the template has a 'members' table with 'join_date' and 'status' fields, reference them by name.",
    "- Use ONLY this JSON data when giving numeric answers.",
    "- When displaying currency amounts, use the currency symbol from the 'unit' field (e.g., €, $, £, CHF) instead of the word 'currency' or currency codes.",
    "- If the 'insights' array exists and has items, these are AI-generated insights about the user's dashboard. You can reference these insights when answering questions about the dashboard, trends, or recommendations.",
    "- When the user asks about 'insights', 'AI insights', 'dashboard insights', or 'recommendations', refer to the insights array in the JSON data.",
    '- If the user asks something outside the scope of this data (e.g., "write my marketing plan"), you can still answer normally as a helpful finance copilot, but don\'t fabricate KPIs that are not in the JSON data.',
    "- Be thorough and provide actionable insights that help the user make informed business decisions.",
  ].join("\n");

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: systemPrompt,
    messages: convertToCoreMessages(messages),
    temperature: 0.4, // Slightly higher temperature for more natural, detailed responses
  });

  return result.toUIMessageStreamResponse();
}
