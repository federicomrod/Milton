// No orange, amber or yellow "warning" colour anywhere in the app: warnings
// are neutral gray, actions are brand blue, red is only for real errors.
// Nothing is allow-listed.
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOTS = ["components", "app", "lib"];
const EXT = /\.(ts|tsx|css)$/;
const FORBIDDEN = new RegExp(
  [
    // the named hexes
    "#a35a00",
    "#92400e",
    "#d97706",
    "#f59e0b",
    "#b45309",
    "#f28c28",
    // Tailwind palettes, any utility / prefix / shade
    "(?:amber|orange|yellow)-(?:\\d|\\[)",
    // the words as tone / palette names
    "\\b(?:amber|orange|yellow)\\b",
  ].join("|"),
  "i"
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory()
      ? files(path)
      : EXT.test(name)
        ? [path]
        : [];
  });
}

describe("no orange / amber / yellow colours", () => {
  it("components/, app/ and lib/ have none", () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of files(root)) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((text, i) => {
            if (FORBIDDEN.test(text))
              hits.push(`${file}:${i + 1}: ${text.trim()}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
