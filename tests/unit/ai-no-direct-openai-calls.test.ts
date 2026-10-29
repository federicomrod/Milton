import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Every OpenAI call goes through lib/ai/call.ts (runChat / runTranscription),
// so retries, timeouts, error classification and usage logging stay in one
// place. This test fails if any other file calls the create methods directly.

const ROOT = process.cwd();
const ALLOWED = new Set(["lib/ai/call.ts"]);
const SKIP = new Set(["node_modules", ".next", ".git", "tests", "dist"]);
const DIRECT =
  /\bchat\s*\.\s*completions\s*\.\s*create\b|\baudio\s*\.\s*transcriptions\s*\.\s*create\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("direct OpenAI calls", () => {
  it("only lib/ai/call.ts calls chat.completions.create or audio.transcriptions.create", () => {
    const offenders = ["app", "lib", "components", "scripts"]
      .flatMap((d) => {
        try {
          return walk(join(ROOT, d));
        } catch {
          return [];
        }
      })
      .map((f) => relative(ROOT, f))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => DIRECT.test(readFileSync(join(ROOT, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
