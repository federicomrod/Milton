import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Email Briefing Extension v1 — proves (by content regression, since
// route handlers aren't executed directly in this test suite — see
// tests/unit/migration-013-index.test.ts for the same convention applied
// to SQL) that the test-send route has NO input surface for company_id or
// recipient: both must come exclusively from authAndCompany() and the
// company's own saved companies.briefing_email_recipient, never from the
// request body. This is the structural guarantee behind "test-send
// recipient/company isolation" and "do not accept arbitrary company_id
// or arbitrary recipient email".

const ROUTE_PATH = join(
  process.cwd(),
  "app/api/restaurant/briefing/email/send-test/route.ts"
);
const source = readFileSync(ROUTE_PATH, "utf8");

describe("send-test route — no request-supplied company_id or recipient", () => {
  it("never parses a JSON request body", () => {
    expect(source).not.toContain("req.json()");
    expect(source).not.toContain("request.json()");
  });

  it("never references a body-supplied company_id or recipient field", () => {
    expect(source).not.toMatch(/body\.(company_id|companyId|recipient|to)\b/);
  });

  it("resolves companyId exclusively via authAndCompany()", () => {
    expect(source).toContain("authAndCompany()");
    expect(source).toMatch(
      /const\s*\{\s*supabase,\s*companyId\s*\}\s*=\s*auth/
    );
  });

  it("loads the recipient from the company's own saved row, scoped by companyId", () => {
    expect(source).toMatch(/\.eq\("id",\s*companyId\)/);
    expect(source).toContain("briefing_email_recipient");
  });

  it("validates the loaded recipient before sending (never trusts the raw DB value)", () => {
    expect(source).toContain(
      "normalizeEmail(company?.briefing_email_recipient)"
    );
  });
});
