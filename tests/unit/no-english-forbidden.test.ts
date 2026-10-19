// Every refusal the person can read is Spanish: no "Forbidden" JSON bodies,
// and no role compared by hand outside lib/auth (the one permissions table).
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory()
      ? files(path)
      : /\.(ts|tsx)$/.test(name)
        ? [path]
        : [];
  });
}
const all = ["app", "lib", "components"].flatMap(files);
const lines = (re: RegExp, skip: RegExp = /^$/) =>
  all
    .filter((f) => !skip.test(f))
    .flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((text, i) => ({ at: `${f}:${i + 1}`, text }))
        .filter((l) => re.test(l.text))
        .map((l) => `${l.at}: ${l.text.trim()}`)
    );

describe("one permissions table", () => {
  it("no English «Forbidden» in a response", () => {
    expect(lines(/["']Forbidden["']/)).toEqual([]);
  });

  it("no company role is compared by hand outside lib/auth", () => {
    // `role === "owner"` / `membershipRole === "admin"` style checks
    const hits = lines(
      /(?:role|Role)\s*(?:===|!==)\s*["'](?:owner|admin|manager|viewer|member|analyst)["']/,
      // lib/auth is the table; invites validate the role in the BODY of an
      // invite (input validation); profile-service reads the legacy profile
      // flag (Milton admin), not a company role.
      /^(lib\/auth\/|app\/api\/management\/invites\/route\.ts|lib\/profile-service\.ts)/
    );
    expect(hits).toEqual([]);
  });
});
