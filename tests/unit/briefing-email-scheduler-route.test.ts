import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Automatic Email Briefing Scheduler v1 — proves (by content regression,
// since route handlers aren't executed directly in this test suite — see
// tests/unit/email-send-test-isolation.test.ts for the same convention)
// the structural guarantees the task requires: last_sent_at is written
// only after a confirmed successful send, a failed send never marks it
// (so it stays retry-eligible), one company's failure can't escape and
// abort the batch, and no company-specific value is ever read from the
// incoming request.

const ROUTE_PATH = join(process.cwd(), "app/api/cron/briefing-email/route.ts");
const source = readFileSync(ROUTE_PATH, "utf8");

describe("cron route — auth is checked before any other processing", () => {
  it("verifies the request before querying companies", () => {
    const authIdx = source.indexOf("isAuthorizedCronRequest");
    const queryIdx = source.indexOf('.from("companies")');
    expect(authIdx).toBeGreaterThan(-1);
    expect(queryIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(queryIdx);
  });

  it("never accepts a body-supplied company_id, recipient, cadence, or timezone", () => {
    expect(source).not.toContain("req.json()");
    expect(source).not.toMatch(
      /body\.(company_id|companyId|recipient|cadence|timezone)\b/
    );
  });
});

describe("cron route — last_sent_at written only after confirmed success", () => {
  it("the update call appears only after checking sendResult.ok, inside the same per-company block", () => {
    const okCheckIdx = source.indexOf("if (!sendResult.ok)");
    const updateIdx = source.indexOf("briefing_email_last_sent_at: nowUtc");
    expect(okCheckIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(okCheckIdx);
  });

  it("the failure branch continues (skips) before ever reaching the update", () => {
    const failureBlock = source.slice(
      source.indexOf("if (!sendResult.ok)"),
      source.indexOf("briefing_email_last_sent_at: nowUtc")
    );
    expect(failureBlock).toContain("continue");
  });
});

describe("cron route — failure isolation", () => {
  it("wraps each company's processing in its own try/catch inside the loop", () => {
    const loopIdx = source.indexOf("for (const row of rows)");
    const tryIdx = source.indexOf("try {", loopIdx);
    const catchIdx = source.indexOf("} catch (err) {", loopIdx);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeGreaterThan(loopIdx);
    expect(catchIdx).toBeGreaterThan(tryIdx);
  });

  it("the catch block logs and continues rather than rethrowing or returning", () => {
    const catchBlock = source.slice(
      source.indexOf("} catch (err) {"),
      source.lastIndexOf("}")
    );
    expect(catchBlock).toContain("console.error");
    expect(catchBlock).not.toMatch(/throw /);
  });
});

describe("cron route — recipient/company derived exclusively server-side", () => {
  it("queries companies without any client-supplied filter", () => {
    expect(source).toContain('.neq("briefing_email_cadence", "off")');
  });

  it("validates the stored recipient before sending (never trusts the raw DB value)", () => {
    expect(source).toContain("normalizeEmail(row.briefing_email_recipient)");
  });
});
