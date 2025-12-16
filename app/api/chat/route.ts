import { streamText, convertToCoreMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { handleSemanticMessage } from "@/lib/semantic-query-service";
import {
  BUSINESS_TYPE_AI_GUIDANCE,
  DEFAULT_BUSINESS_TYPE,
  type BusinessTypeId,
} from "@/lib/business-types";
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

  // Determine business type for this user
  let businessType: BusinessTypeId = DEFAULT_BUSINESS_TYPE;

  const { data: modelRow, error: modelError } = await supabase
    .from("business_models")
    .select("business_type")
    .eq("user_id", user.id)
    .single();

  if (!modelError && modelRow?.business_type) {
    const validTypes: BusinessTypeId[] = ["saas", "agency", "fitness_studio"];
    const rawType = modelRow.business_type as string;

    if (validTypes.includes(rawType as BusinessTypeId)) {
      businessType = rawType as BusinessTypeId;
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
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
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
  const dashboardContext = await buildDashboardContextForUser(user.id);

  // Build business-type-specific guidance
  const businessInstruction = BUSINESS_TYPE_AI_GUIDANCE[businessType];

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
    "- Use ONLY this JSON data when giving numeric answers.",
    "- If a metric is missing or the relevant data flags (like hasKpiSnapshots/hasTransactions) are false, explicitly say what is missing and suggest which files or data the user should upload.",
    '- For missing data, suggest uploading specific files (e.g., "upload your sales transactions", "upload your CRM deals", "upload your bookings data").',
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
