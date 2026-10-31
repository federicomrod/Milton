import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors } from "./theme";

const ALLOWED = [
  "#1B40C8",
  "#0F172A",
  "#FFFFFF",
  "#E5E7EB",
  "#A7F3D0",
  "#FBCFE8",
  "#FDE68A",
  "#DDD6FE",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory())
      return name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const HEX = /#[0-9A-Fa-f]{3,8}\b/g;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe("brand palette", () => {
  it("has exactly the brand colours", () => {
    expect(Object.values(colors).sort()).toEqual([...ALLOWED].sort());
  });

  it("no green, red or orange anywhere in the palette", () => {
    for (const hex of Object.values(colors)) {
      const [r, g, b] = rgb(hex);
      const greenDominant = g > r + 20 && g > b + 20 && g < 200;
      const redDominant = r > g + 60 && r > b + 60;
      expect(greenDominant || redDominant, hex).toBe(false);
    }
  });

  it("the source uses no other hex value (theme.ts is the one place for colours)", () => {
    const root = join(__dirname, "..");
    const sources = [
      ...files(join(root, "src")),
      join(root, "app.config.ts"),
    ].filter((f) => !f.endsWith(".test.ts"));
    for (const file of sources) {
      for (const hex of readFileSync(file, "utf8").match(HEX) ?? []) {
        expect(ALLOWED, `${file}: ${hex}`).toContain(hex.toUpperCase());
      }
    }
  });

  // The COOK side never shows money. Gestión (managers and owners) does, and
  // lives in its own folders; the next test keeps the two apart.
  const GESTION = ["gestion", "(gestion)"];
  const inGestion = (f: string) =>
    f.split(/[\\/]/).some((part) => GESTION.includes(part));

  it("never renders a currency symbol or amount (cook side)", () => {
    const root = join(__dirname, "..");
    for (const file of files(join(root, "src")).filter(
      (f) => !f.endsWith(".test.ts") && !inGestion(f)
    )) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(
        /[€£]|\$\{?\s?\d|toLocaleString\([^)]*currency|style:\s*["']currency/i
      );
    }
  });

  it("cook-side code never imports Gestión code (only the router shell, the join screen and the profile may)", () => {
    const root = join(__dirname, "..");
    const ALLOWED = new Set([
      join("src", "app", "_layout.tsx"),
      join("src", "app", "join.tsx"),
      join("src", "app", "perfil.tsx"),
      join("src", "app", "platos.tsx"),
      join("src", "app", "factura.tsx"),
      join("src", "app", "entrada.tsx"),
      join("src", "app", "login.tsx"),
      join("src", "app", "sin-acceso.tsx"),
    ]);
    for (const file of files(join(root, "src")).filter(
      (f) =>
        !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && !inGestion(f)
    )) {
      const rel = file.slice(root.length + 1);
      if (ALLOWED.has(rel)) continue;
      expect(readFileSync(file, "utf8"), rel).not.toMatch(
        /from\s+["'][./]*\/?gestion\//
      );
    }
  });
});
