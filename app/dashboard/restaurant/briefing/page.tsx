// app/dashboard/restaurant/briefing/page.tsx
//
// "Ask Milton" workspace — Stage 1 of Milestone 3.
//
// AI-native page where the operator can ask natural-language questions about
// their restaurant data. Answers are grounded in the structured
// AskMiltonContext server-side (see /api/restaurant/ask-milton) and never
// invent numbers. Stage 1 is read-only: no actions executed, no memory
// persisted, no streaming, no agent runs from chat.
//
// Layout:
//   1. Header
//   2. Executive briefing panel (reuses /api/restaurant/briefing)
//   3. Suggested question chips
//   4. Chat workspace (message list, input, send)
//
// All OpenAI calls happen server-side via the API routes — this file is a
// thin client shell.

import { AskMiltonWorkspace } from "@/components/restaurant/AskMiltonWorkspace";

export const dynamic = "force-dynamic";

export default function AskMiltonPage() {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Ask Milton</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Ask questions about sales, margins, suppliers, invoices, recipes and
          agent recommendations. Milton answers from your live data — read-only
          for now.
        </p>
      </header>
      <AskMiltonWorkspace />
    </div>
  );
}
