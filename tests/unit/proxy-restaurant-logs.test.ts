// Restaurant requests must not write a proxy console.log / console.info
// (the leftover PROD-bypass and cockpit-timing lines). Server-Timing stays.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");

function blockAfter(marker: string, closer: string): string {
  const start = src.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const from = src.indexOf("{", start);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  throw new Error(`unclosed block after ${closer}`);
}

describe("proxy.ts restaurant path has no per-request logs", () => {
  it("the restaurant-pivot block sets Server-Timing and does not log", () => {
    const block = blockAfter(
      "if (isRestaurantPivotRoute)",
      "isRestaurantPivotRoute"
    );
    expect(block).toContain("Server-Timing");
    expect(block).toContain("proxy;dur=");
    expect(block).not.toMatch(/console\.(log|info|debug|warn)\(/);
  });

  it("dev restaurant bypass does not log either", () => {
    const block = blockAfter(
      'pathname.startsWith("/dashboard/restaurant")',
      "DEV bypass"
    );
    expect(block).toContain("NextResponse.next()");
    expect(block).not.toMatch(/console\.(log|info|debug|warn)\(/);
  });

  it("the leftover diagnostic strings are gone", () => {
    expect(src).not.toContain("[Proxy] PROD bypass");
    expect(src).not.toContain("[cockpit-timing] proxy");
    expect(src).not.toContain("User ${user.id} accessing");
    expect(src).not.toContain("Redirecting ${user.id}");
    expect(src).not.toContain("[Proxy] Access granted");
  });
});
