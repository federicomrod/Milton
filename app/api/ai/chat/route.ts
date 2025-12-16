import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";
import { handleSemanticMessage } from "@/lib/semantic-query-service";
import {
  BUSINESS_TYPE_AI_GUIDANCE,
  DEFAULT_BUSINESS_TYPE,
  type BusinessTypeId,
} from "@/lib/business-types";
import { buildDashboardContextForUser } from "@/lib/ai/dashboard-context";

// Lazy initialization to avoid errors during build time
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const supabase = await createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { message } = await req.json().catch(() => ({ message: "" }));
  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { error: 'Missing "message" in body' },
      { status: 400 }
    );
  }

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

  // If the user message mentions chart or visualization, handle it via semantic service
  if (/\b(chart|graph|plot|compare|trend|visual)\b/i.test(message)) {
    const semanticResult = await handleSemanticMessage(message, user.id);
    return NextResponse.json({
      reply: semanticResult.text,
      chart: semanticResult.chartConfig,
      data: semanticResult.data,
    });
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

  const userPrompt = message;

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const reply =
    completion.choices?.[0]?.message?.content?.trim() ||
    "I could not generate a response.";
  return NextResponse.json({ reply });
}
