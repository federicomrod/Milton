import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Content-based regression check for migration 020 (not executed here).

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/020_workspace_invites.sql"),
  "utf8"
);
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const rpc = code.slice(
  code.indexOf("CREATE OR REPLACE FUNCTION public.accept_workspace_invite"),
  code.indexOf("REVOKE ALL ON FUNCTION public.accept_workspace_invite")
);

describe("migration 020", () => {
  it("stores only a token hash (unique), never a raw token", () => {
    expect(code).toMatch(/token_hash\s+text NOT NULL UNIQUE/);
    expect(code).not.toMatch(/\btoken\s+text/);
  });
  it("has the partial unique index on live invites per company+email", () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_live_email_uniq[\s\S]*?\(company_id, lower\(email\)\)[\s\S]*?WHERE accepted_at IS NULL AND revoked_at IS NULL/
    );
  });
  it("checks role in ('owner','member') and defaults expiry to 7 days", () => {
    expect(code).toContain("CHECK (role IN ('owner', 'member'))");
    expect(code).toContain("interval '7 days'");
  });
  it("enables RLS on both new tables", () => {
    expect(code).toContain(
      "ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY"
    );
    expect(code).toContain(
      "ALTER TABLE public.data_source_requests ENABLE ROW LEVEL SECURITY"
    );
  });
  it("gives invitees no policy on workspace_invites and no UPDATE/DELETE on requests", () => {
    const inviteSection = code.slice(
      0,
      code.indexOf("accept_workspace_invite(")
    );
    for (const m of inviteSection.matchAll(
      /CREATE POLICY (\w+) ON public\.workspace_invites/g
    )) {
      expect(m[1]).toMatch(/admin/);
    }
    expect(code).not.toMatch(
      /CREATE POLICY \w+ ON public\.data_source_requests\s+FOR (UPDATE|DELETE)/
    );
  });
  it("uses is_company_member for data_source_requests", () => {
    expect(code).toContain("public.is_company_member(company_id)");
  });
  it("grants accept_workspace_invite to service_role only", () => {
    expect(code).toContain(
      "GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(text, uuid) TO service_role"
    );
    expect(code).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.accept_workspace_invite[^;]*TO (authenticated|anon|PUBLIC)/i
    );
    expect(code).toContain(
      "REVOKE ALL ON FUNCTION public.accept_workspace_invite(text, uuid) FROM PUBLIC"
    );
  });
  it("the RPC never creates a company or calls bootstrap_restaurant_user", () => {
    expect(rpc.length).toBeGreaterThan(200);
    expect(rpc).not.toMatch(/INSERT INTO public\.companies/i);
    expect(rpc).not.toContain("bootstrap_restaurant_user");
    expect(rpc).toContain("already_member_of_other_company");
    for (const c of [
      "invite_already_accepted",
      "invite_revoked",
      "invite_expired",
      "email_mismatch",
    ]) {
      expect(rpc).toContain(c);
    }
  });
  it("is additive: no DROP, no ALTER of existing tables, no policy changes", () => {
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/ALTER POLICY/i);
    const alters = [...code.matchAll(/ALTER TABLE ([\w.]+)/g)].map((m) => m[1]);
    for (const t of alters) {
      expect([
        "public.workspace_invites",
        "public.data_source_requests",
      ]).toContain(t);
    }
    expect(code).not.toMatch(/\bDELETE FROM\b/i);
  });
  it("contains the manual-apply note", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
  });
});
