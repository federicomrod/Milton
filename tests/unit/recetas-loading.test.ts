// Speed fix 2: Recetas y costeo answers clicks at once — a skeleton while
// the page first renders, and a "Cargando…" state while a tab or dish
// switch re-renders on the server.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Recetas y costeo loading feedback", () => {
  it("has its own skeleton while the page renders", () => {
    // Recetas is now the Menú tabs (R1-09b); each tab route has its own.
    const file = "app/dashboard/restaurant/menu/platos/loading.tsx";
    expect(existsSync(join(process.cwd(), file))).toBe(true);
    const src = read(file);
    expect(src).toMatch(/Skeleton/);
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
    // R1-13: choosing a preparation no longer re-renders the page on the
    // server (address bar only); any router.replace left is still wrapped.
    expect(wrapped.length).toBe(replaces.length);
    const pushes = src.match(/router\.push\(/g) ?? [];
    const wrappedPushes =
      src.match(/startNavigation\(\(\) => (\{\s*)?router\.push\(/g) ?? [];
    expect(wrappedPushes.length).toBe(pushes.length);
    expect(src).toContain("Cargando…");
    expect(src).toContain("aria-busy={navigating}");
  });
});
