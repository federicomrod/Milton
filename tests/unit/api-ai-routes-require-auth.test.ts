// Every app/api/**/route.ts that talks to OpenAI must also check auth.
// Catches a re-added open proxy like the old /api/openai-analyze.
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, sep } from "path";
import { describe, expect, it } from "vitest";

const OPENAI =
  /from\s+["']@\/lib\/openai-client["']|from\s+["']openai["']|from\s+["']@ai-sdk\/openai["']|import\(\s*["']openai["']\s*\)|\bgenerateText\s*\(/;

const AUTH =
  /\bauthAndCompany\b|\brequireMiltonStaff\b|\bgetClaims\b|\.auth\.getUser\b|\bTELEGRAM_WEBHOOK_SECRET\b|\bisValidWebhookSecret\b|\bCRON_SECRET\b/;

/** route file (relative to app/api) -> why the file itself has no auth call. */
const ALLOW: Record<string, string> = {
  // gate() calls authAndCompany(); the route never talks to OpenAI unauthenticated.
  "restaurant/ingredients/duplicates/suggest/route.ts":
    "uses gate() which calls authAndCompany before the OpenAI call",
};

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? routes(path)
      : name === "route.ts"
        ? [path]
        : [];
  });
}

export function usesOpenAI(src: string): boolean {
  return OPENAI.test(src);
}

export function checksAuth(src: string): boolean {
  return AUTH.test(src);
}

export function unauthenticatedOpenAIRoutes(
  files: Array<{ rel: string; src: string }>
): string[] {
  return files
    .filter((f) => usesOpenAI(f.src) && !checksAuth(f.src) && !(f.rel in ALLOW))
    .map((f) => f.rel);
}

const files = routes("app/api").map((f) => ({
  rel: f.split(sep).slice(2).join("/"),
  src: readFileSync(f, "utf8"),
}));

const GONE = [
  "app/api/openai-analyze/route.ts",
  "app/api/ai/insight-generator/route.ts",
  "app/api/ai/forecast-generator/route.ts",
  "app/api/ai/column-mapper/route.ts",
  "app/api/ai/dataset-classifier/route.ts",
  "app/api/ai/business-model-analyzer/route.ts",
  "app/api/ai/onboarding/route.ts",
  "app/api/charts/generate/route.ts",
  "app/api/milton/ask/route.ts",
];

describe("API routes that call OpenAI also check auth", () => {
  it("the unauthenticated legacy AI routes are gone", () => {
    for (const f of GONE) expect(existsSync(f), f).toBe(false);
  });

  it("every remaining OpenAI route checks auth (or is allow-listed)", () => {
    expect(unauthenticatedOpenAIRoutes(files)).toEqual([]);
  });

  it("the allow-list has no stale entries and every entry has a reason", () => {
    const openaiPaths = new Set(
      files.filter((f) => usesOpenAI(f.src)).map((f) => f.rel)
    );
    const stale = Object.keys(ALLOW).filter((k) => !openaiPaths.has(k));
    expect(stale).toEqual([]);
    for (const [path, why] of Object.entries(ALLOW)) {
      expect(why.length, path).toBeGreaterThan(8);
    }
  });

  it("fails if openai-analyze is re-added without auth", () => {
    const src = `import { openai } from "@/lib/openai-client";
export async function POST() {
  return openai.chat.completions.create({ model: "gpt-4", messages: [] });
}
`;
    expect(usesOpenAI(src)).toBe(true);
    expect(checksAuth(src)).toBe(false);
    expect(
      unauthenticatedOpenAIRoutes([{ rel: "openai-analyze/route.ts", src }])
    ).toEqual(["openai-analyze/route.ts"]);
  });

  it("passes the same source once it calls authAndCompany", () => {
    const src = `import { openai } from "@/lib/openai-client";
import { authAndCompany } from "@/lib/restaurant/api-auth";
export async function POST() {
  const auth = await authAndCompany();
  return openai.chat.completions.create({ model: "gpt-4", messages: [] });
}
`;
    expect(
      unauthenticatedOpenAIRoutes([{ rel: "openai-analyze/route.ts", src }])
    ).toEqual([]);
  });
});
