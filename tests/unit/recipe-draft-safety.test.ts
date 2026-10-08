import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const FILES = [
  "app/api/telegram/webhook/route.ts",
  "lib/restaurant/telegram/kitchen-recipe-drafts.ts",
  "app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route.ts",
  "app/api/restaurant/kitchen/recipe-drafts/[id]/route.ts",
];

describe("recipe-draft source safety", () => {
  it("does not log secrets, file ids, transcripts or message bodies", () => {
    for (const file of FILES) {
      const src = read(file);
      for (const match of src.matchAll(
        /console\.(log|error|warn)\(([\s\S]*?)\);/g
      )) {
        const call = match[0];
        expect(call).not.toMatch(/TELEGRAM_BOT_TOKEN|OPENAI_API_KEY/i);
        expect(call).not.toMatch(/telegramFileId|file_id|transcript/i);
        expect(call).not.toMatch(/textContent|caption|message\.text/i);
      }
    }
  });

  it("defers recipe work with after() from next/server", () => {
    const src = read("app/api/telegram/webhook/route.ts");
    expect(src).toMatch(/import \{[^}]*\bafter\b[^}]*\} from "next\/server"/);
    expect(src).toContain("after(() =>");
    expect(src).toContain("processRecipeDraftAsync(");
  });

  it("records follow-up message ids so Telegram retries return early", () => {
    const src = read("app/api/telegram/webhook/route.ts");
    expect(src).toContain("parsePortionsFromFollowUp");
    expect(src).toContain("recordKitchenReport");
    expect(src).toContain("if (!inserted)");
  });
});
