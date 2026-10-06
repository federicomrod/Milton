import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Content regression for the invite + password-recovery pack (R1 item 2).

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
// Code only: drop // line comments so prose can mention banned words.
const code = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const NEW_FILES = [
  ...walk("app/api/management/invites"),
  "app/management/invites/page.tsx",
  "app/api/auth/invite/accept/route.ts",
  "app/auth/invite/page.tsx",
  "components/auth/invite-accept-form.tsx",
  "app/auth/forgot-password/page.tsx",
  "app/auth/reset-password/page.tsx",
  "app/api/restaurant/data-source-requests/route.ts",
  "app/dashboard/restaurant/connect-data/page.tsx",
  "components/restaurant/connect-data/ConnectDataOptions.tsx",
  "lib/auth/invite-token.ts",
  "lib/restaurant/data-connection.ts",
  "lib/restaurant/post-login.ts",
];

describe("invite acceptance", () => {
  const src = read("app/api/auth/invite/accept/route.ts");
  it("calls accept_workspace_invite and never the self-serve bootstrap", () => {
    expect(src).toContain("accept_workspace_invite");
    expect(src).not.toContain("bootstrap_restaurant_user");
  });
  it("never inserts a company", () => {
    expect(src).not.toMatch(/from\(["']companies["']\)\s*\.insert/);
  });
});

describe("admin-only management routes", () => {
  const routes = walk("app/api/management/invites").filter((f) =>
    f.endsWith("route.ts")
  );
  it("finds the invite routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });
  it.each(routes)("%s calls isUserAdminServer(", (f) => {
    expect(read(f)).toContain("isUserAdminServer(");
  });
  it("never selects token_hash in list queries", () => {
    const src = code("app/api/management/invites/route.ts");
    const list = src.slice(src.indexOf("export async function GET"));
    expect(list).not.toContain("token_hash");
  });
});

describe("no secrets in logs", () => {
  it.each(NEW_FILES)("%s does not log password/token/token_hash", (f) => {
    const src = read(f);
    for (const m of src.matchAll(/console\.(log|error|warn)\([\s\S]*?\);/g)) {
      expect(m[0]).not.toMatch(/password|token/i);
    }
  });
});

describe("routing", () => {
  it("proxy.ts publicRoutes contains the three new paths", () => {
    const src = read("proxy.ts");
    const block = src.slice(
      src.indexOf("const publicRoutes"),
      src.indexOf("];", src.indexOf("const publicRoutes"))
    );
    for (const p of [
      "/auth/invite",
      "/auth/forgot-password",
      "/auth/reset-password",
    ]) {
      expect(block).toContain(`"${p}"`);
    }
  });

  it("callback and login form use resolveInvitedUserLanding after the admin check", () => {
    for (const f of [
      "app/auth/callback/route.ts",
      "components/auth/login-form.tsx",
    ]) {
      const src = read(f);
      expect(src).toContain("import { resolveInvitedUserLanding }");
      const adminAt = src.indexOf('is_milton_admin"');
      const invitedAt = src.indexOf("resolveInvitedUserLanding(");
      expect(adminAt).toBeGreaterThan(-1);
      expect(invitedAt).toBeGreaterThan(adminAt);
      // ...and before the self-serve onboarding check.
      expect(invitedAt).toBeLessThan(src.indexOf("onboarding_status"));
    }
  });

  it("signup-complete checks for a live invite before calling the RPC", () => {
    const src = code("app/api/auth/signup-complete/route.ts");
    expect(src).toContain("pending_invite");
    expect(src.indexOf("pending_invite")).toBeGreaterThan(-1);
    expect(src.indexOf("pending_invite")).toBeLessThan(
      src.indexOf("adminClient.rpc(")
    );
  });
});

describe("data-source-requests route", () => {
  const src = code("app/api/restaurant/data-source-requests/route.ts");
  it("uses authAndCompany() and never reads body.company_id", () => {
    expect(src).toContain("authAndCompany(");
    expect(src).not.toMatch(/body\.company_id/);
  });
  it("sends nothing externally", () => {
    expect(src).not.toMatch(/fetch\(|slack|resend|sendBriefingEmail/i);
  });
});

describe("forgot-password page", () => {
  const src = read("app/auth/forgot-password/page.tsx");
  it("ignores the provider result so the message never depends on the email", () => {
    expect(src).not.toMatch(
      /(const|let)\s*\{[^}]*\berror\b[^}]*\}\s*=\s*await[^;]*resetPasswordForEmail/
    );
    expect(src).not.toMatch(/=\s*await[^;]*resetPasswordForEmail/);
    expect(
      src.match(/If an account exists, we(&apos;|')ve sent a link\./g)
    ).toHaveLength(1);
  });
});
