// Every API route that WRITES (POST / PUT / PATCH / DELETE) must ask the one
// permissions helper (lib/auth/permissions) who may do it, or sit in the
// short allow-list below with a one-line reason. A new write route that
// forgets the check fails here.
import { readFileSync, readdirSync, statSync } from "fs";
import { join, sep } from "path";
import { describe, expect, it } from "vitest";

const CHECKS =
  // recipes/editor starts resolveActor early and asks can() on that promise
  // (a parallel guard, for speed): the same helper, so it counts.
  /requireCapability\(|requireMiltonStaff\(|loadRecipeActor\(|kitchenManagerGuard\(|resolveActor\([\s\S]*\bcan\(/;
const WRITE =
  /export\s+(?:async\s+function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/;

/** route file (relative to app/api) -> why it needs no capability. */
export const ALLOW: Record<string, string> = {
  // Auth and per-user flows
  "auth/invite/accept/route.ts":
    "accepting an invite: the invite token is the authority",
  "auth/signup-complete/route.ts":
    "finishes the signed-in person's own sign-up",
  "telegram/webhook/route.ts":
    "Telegram calls it with a secret token, not a person",
  "restaurant/briefing/email/preferences/route.ts": "per-user email preference",
  "restaurant/briefing/email/send-test/route.ts":
    "sends one email to the company's saved address; changes nothing",
  "restaurant/onboarding/complete/route.ts":
    "marks the signed-in person's own onboarding as done",
  "business-type/route.ts":
    "classifies text during onboarding; writes nothing company-wide",
  // Reads and analysis that write nothing company-wide
  "chat/route.ts": "AI chat; writes nothing company-wide",
  "restaurant/ask-milton/route.ts":
    "read-only chat over the restaurant context",
  "restaurant/data-source-requests/route.ts":
    "records a «please support this source» request for Milton; no company data",
  "restaurant/kitchen/reports/resolve/route.ts":
    "any company member resolves cook reports, by design (documented in the route)",
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

const files = routes("app/api").map((f) => ({
  rel: f.split(sep).slice(2).join("/"),
  src: readFileSync(f, "utf8"),
}));
const writers = files.filter((f) => WRITE.test(f.src));

describe("every write route asks the permissions helper", () => {
  it("finds the write routes", () => {
    expect(writers.length).toBeGreaterThan(40);
  });

  it("each calls requireCapability / requireMiltonStaff / the recipe actor / the kitchen guard, or is allow-listed", () => {
    const missing = writers
      .filter((f) => !CHECKS.test(f.src) && !(f.rel in ALLOW))
      .map((f) => f.rel);
    expect(missing).toEqual([]);
  });

  it("the allow-list has no stale entries and every entry has a reason", () => {
    const writerPaths = new Set(writers.map((f) => f.rel));
    const stale = Object.keys(ALLOW).filter((k) => !writerPaths.has(k));
    expect(stale).toEqual([]);
    for (const [path, why] of Object.entries(ALLOW)) {
      expect(why.length, path).toBeGreaterThan(8);
    }
  });

  it("a route in the allow-list does not also check (move it out)", () => {
    const both = writers
      .filter((f) => f.rel in ALLOW && CHECKS.test(f.src))
      .map((f) => f.rel);
    expect(both).toEqual([]);
  });
});
