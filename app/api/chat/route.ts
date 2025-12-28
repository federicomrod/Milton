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

  // Get the last user message - UIMessage has parts array
  const lastMessage = messages[messages.length - 1];
  let userMessage = "";
  if (
    lastMessage &&
    "parts" in lastMessage &&
    Array.isArray(lastMessage.parts)
  ) {
    userMessage = lastMessage.parts
      .filter((part: { type: string; text?: string }) => part.type === "text")
      .map((part: { type: string; text?: string }) => part.text || "")
      .join("");
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
    "You are Milton, an AI finance copilot for small businesses.",
    businessInstruction,
    "",
    "You have access to the following structured data about the user's business in JSON form:",
    "JSON_START",
    JSON.stringify(dashboardContext, null, 2),
    "JSON_END",
    "",
    "Rules:",
    "- ALWAYS check the dataAvailability flags in the JSON data first.",
    "- If hasTransactions is true, you HAVE transaction data available. Even if revenue/expenses KPIs show 0, you can still provide insights about the transaction data structure, count, and patterns.",
    "- If hasCrmDeals is true, you HAVE CRM deal data. Use the pipelineValue and openDeals KPIs to provide insights.",
    "- If hasBudgets is true, you HAVE budget data available. Use it to provide insights.",
    "- If kpis array has items with non-null currentValue, reference those specific KPIs in your response.",
    "- If monthlyRevenue object has keys, you have monthly revenue trends. Use it for trend analysis.",
    "- When data IS available (dataAvailability flags are true), provide specific insights based on what you see in the JSON, even if some KPIs are 0.",
    "- ONLY suggest uploading files if ALL dataAvailability flags are false AND kpis array is empty.",
    "- If transactions exist but revenue is 0, mention that you see transaction data but the amounts may need review, or ask about the transaction structure.",
    "- Use ONLY this JSON data when giving numeric answers.",
    "- Prefer concise, numeric answers first, then one short sentence of explanation.",
    '- If the user asks something outside the scope of this data (e.g., "write my marketing plan"), you can still answer normally as a helpful finance copilot, but don\'t fabricate KPIs that are not in the JSON data.',
    "- Keep answers concise (≤6 sentences) and actionable.",
  ].join("\n");

  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: systemPrompt,
    messages: convertToCoreMessages(messages),
    temperature: 0.2,
  });

  return result.toUIMessageStreamResponse();
}
