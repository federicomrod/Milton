import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Content regression for the kitchen QR join + cook reports pack
// (R1 #55 / #49).

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
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

const CLIENT_ROUTES = walk("app/api/restaurant/kitchen").filter((f) =>
  f.endsWith("route.ts")
);
const NEW_FILES = [
  ...walk("app/api/restaurant/kitchen"),
  ...walk("app/api/management/kitchen"),
  ...walk("components/restaurant/kitchen"),
  "app/api/telegram/webhook/route.ts",
  "app/dashboard/restaurant/kitchen/page.tsx",
  "app/management/kitchen/page.tsx",
  "lib/restaurant/telegram/kitchen-join.ts",
  "lib/restaurant/telegram/kitchen-reports.ts",
  "lib/restaurant/telegram/kitchen-qr.ts",
  "lib/restaurant/telegram/kitchen-copy.ts",
  "lib/restaurant/telegram/files.ts",
];

describe("webhook dispatch", () => {
  const src = code("app/api/telegram/webhook/route.ts");
  it("keeps the manager pairing path and checks the kitchen payload first", () => {
    expect(src).toContain("consumePairingCode(");
    const kitchenAt = src.indexOf("isKitchenPayload(code)");
    expect(kitchenAt).toBeGreaterThan(-1);
    expect(kitchenAt).toBeLessThan(src.indexOf("consumePairingCode(code"));
  });
  it("still verifies the secret before any processing", () => {
    expect(src.indexOf("verifyWebhookSecret(req)")).toBeLessThan(
      src.indexOf("req.json()")
    );
  });
  it("acknowledges reports with the generic R5 only", () => {
    expect(src).toContain("KITCHEN_COPY.REPORT_ACK,");
    expect(src).not.toContain("REPORT_ACK_RUNNING_OUT");
    expect(src).not.toContain("REPORT_ACK_WASTE");
  });
  it("only handles private chats for joins and reports", () => {
    expect(src.match(/chat\?\.type !== "private"/g)).toHaveLength(2);
  });
});

describe("bot token handling", () => {
  it("TELEGRAM_BOT_TOKEN is read only in send.ts and files.ts", () => {
    const files = [...walk("app"), ...walk("lib")];
    const readers = files.filter((f) => read(f).includes("TELEGRAM_BOT_TOKEN"));
    expect(readers.sort()).toEqual([
      "lib/restaurant/telegram/files.ts",
      "lib/restaurant/telegram/send.ts",
    ]);
  });
});

describe("manager briefing stays manager-only", () => {
  it("send-briefing never references kitchen_staff", () => {
    const src = read("app/api/restaurant/telegram/send-briefing/route.ts");
    expect(src).not.toContain("kitchen_staff");
    expect(src).not.toContain("kitchen_");
  });
});

describe("route authorization", () => {
  it("finds the kitchen client routes", () => {
    expect(CLIENT_ROUTES.length).toBeGreaterThanOrEqual(5);
  });
  it.each(CLIENT_ROUTES)("%s calls authAndCompany(", (f) => {
    expect(read(f)).toContain("authAndCompany(");
  });
  it("the admin route calls isUserAdminServer(", () => {
    expect(read("app/api/management/kitchen/qr/route.ts")).toContain(
      "isUserAdminServer("
    );
  });
  it("QR POST, staff DELETE and report PATCH call canManageKitchenQr", () => {
    const post = read("app/api/restaurant/kitchen/qr/route.ts");
    expect(post.slice(post.indexOf("export async function POST"))).toContain(
      "canManageKitchenQr("
    );
    expect(read("app/api/restaurant/kitchen/staff/[id]/route.ts")).toContain(
      "canManageKitchenQr("
    );
    expect(read("app/api/restaurant/kitchen/reports/[id]/route.ts")).toContain(
      "canManageKitchenQr("
    );
  });
  it("no kitchen route reads a client-supplied company_id (except the admin route)", () => {
    for (const f of CLIENT_ROUTES) {
      expect(code(f)).not.toMatch(/body\.company_id|get\(["']company_id["']\)/);
    }
  });
  it("the media route compares company_id before streaming", () => {
    const src = read("app/api/restaurant/kitchen/reports/[id]/media/route.ts");
    expect(src).toContain("report.company_id !== companyId");
    expect(src).toContain("private, no-store");
  });
});

describe("no sensitive logging", () => {
  it.each(NEW_FILES)(
    "%s has no console line mentioning token/file_id/text",
    (f) => {
      for (const m of read(f).matchAll(
        /console\.(log|error|warn)\([\s\S]*?\);/g
      )) {
        expect(m[0]).not.toMatch(/token|file_id|\btext\b/i);
      }
    }
  );
});
