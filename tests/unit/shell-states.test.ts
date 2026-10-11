import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { formatLastSyncedAgo, lastSyncTimestamp } from "@/lib/restaurant/last-synced";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("PageSkeleton (#128)", () => {
  const src = read("components/restaurant/shell/PageSkeleton.tsx");

  it("reserves the final slot with width/height so layout does not jump", () => {
    expect(src).toContain("width?: string");
    expect(src).toContain("height?: string");
    expect(src).toContain("style.width = width");
    expect(src).toContain("style.height = height");
    expect(src).toContain('role="status"');
    expect(src).toContain("animate-pulse");
  });

  it("does not render a giant reading-your-numbers box", () => {
    expect(src).not.toContain("Reading your latest restaurant numbers");
  });
});

describe("NotAvailableYet (#128)", () => {
  const src = read("components/restaurant/shell/NotAvailableYet.tsx");

  it("requires a title, reason, and optional link — never a bare dash", () => {
    expect(src).toContain("Not available yet");
    expect(src).toContain("reason");
    expect(src).toContain("href");
    expect(src).toContain("Add costs →");
    expect(src).not.toMatch(/>\s*—\s*</);
    expect(src).not.toContain('{"—"}');
  });
});

describe("last synced copy", () => {
  it("returns null when the timestamp is missing", () => {
    expect(lastSyncTimestamp(null)).toBeNull();
    expect(formatLastSyncedAgo(null)).toBeNull();
    expect(lastSyncTimestamp({ synced_at: "not-a-date" })).toBeNull();
  });

  it("formats a relative Last synced line", () => {
    const now = new Date("2026-07-31T12:08:00.000Z");
    expect(
      formatLastSyncedAgo("2026-07-31T12:00:00.000Z", now, "en")
    ).toBe("Last synced 8 min ago");
  });
});
