import { NextResponse } from "next/server";
import { openai } from "@/lib/openai-client";

export async function POST(request: Request) {
  try {
    const { message, dataStatus } = await request.json();

    const messages = [
      {
        role: "system",
        content:
          "You are Milton, an AI finance assistant that helps startups understand their data. Base your responses on the provided data readiness flags.",
      },
      {
        role: "user",
        content: `Data Status: ${JSON.stringify(dataStatus)}\nUser Message: ${message}`,
      },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const reply = completion.choices[0].message.content;

    return NextResponse.json({ reply });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "An error occurred" }, { status: 500 });
  }
}
