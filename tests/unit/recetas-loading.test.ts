// Speed fix 2: Recetas y costeo answers clicks at once — a skeleton while
// the page first renders, and a "Cargando…" state while a tab or dish
// switch re-renders on the server.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Recetas y costeo loading feedback", () => {
  it("has its own skeleton while the page renders", () => {
    const file = "app/dashboard/restaurant/menu/recetas/loading.tsx";
    expect(existsSync(join(process.cwd(), file))).toBe(true);
    const src = read(file);
    expect(src).toContain("PageSkeleton");
    expect(src).toMatch(/export default function/);
    // A loading file never fetches data.
    expect(src).not.toMatch(/fetch\(|supabase|await /);
  });

  it("every in-page navigation runs as a transition and shows Cargando…", () => {
    const src = read(
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx"
    );
    expect(src).toContain("useTransition");
    const replaces = src.match(/router\.replace\(/g) ?? [];
    const wrapped =
      src.match(/startNavigation\(\(\) => \{\s*router\.replace\(/g) ?? [];
    expect(replaces.length).toBeGreaterThan(0);
    expect(wrapped.length).toBe(replaces.length);
    expect(src).toContain("Cargando…");
    expect(src).toContain("aria-busy={navigating}");
  });
});
