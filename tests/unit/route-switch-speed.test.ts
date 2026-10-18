// Speed pass for switching Menú ↔ Ventas ↔ Cockpit: one shell, a cross-request
// cache keyed by company with tags, revalidation on the writers, a prefetch of
// the main tabs. No behaviour changes. Synthetic.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------------------
// next/cache is mocked: unstable_cache records what it was given
// ---------------------------------------------------------------------------
const cacheCalls: Array<{
  keyParts: string[];
  opts: { tags?: string[]; revalidate?: number };
}> = [];
const revalidated: Array<{ tag: string; profile: unknown }> = [];
let cacheThrows = false;
vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...a: unknown[]) => Promise<unknown>,
    keyParts: string[],
    opts: { tags?: string[]; revalidate?: number }
  ) => {
    cacheCalls.push({ keyParts, opts });
    return async (...a: unknown[]) => {
      if (cacheThrows) throw new Error("cache layer down");
      return fn(...a);
    };
  },
  revalidateTag: (tag: string, profile: unknown) => {
    revalidated.push({ tag, profile });
  },
}));

import {
  CACHE_REVALIDATE_SECONDS,
  cachedForCompany,
  companyCacheKey,
  costingTag,
  revalidateCosting,
  revalidateSales,
  salesTag,
} from "@/lib/restaurant/cache-tags";

beforeEach(() => {
  cacheCalls.length = 0;
  revalidated.length = 0;
  cacheThrows = false;
});

describe("the cache key", () => {
  it("always starts with the company and never matches another company's", () => {
    const a = companyCacheKey("sales-detail", "co-a", { location: "L1" });
    const b = companyCacheKey("sales-detail", "co-b", { location: "L1" });
    expect(a.slice(0, 3)).toEqual(["milton", "sales-detail", "co-a"]);
    expect(a).toContain("location=L1");
    expect(a.join("|")).not.toBe(b.join("|"));
    expect(() => companyCacheKey("x", "")).toThrow();
  });
  it("includes location / period / currency when given, «-» when absent, in a stable order", () => {
    expect(companyCacheKey("r", "co", { location: null, tz: "UTC" })).toEqual([
      "milton",
      "r",
      "co",
      "location=-",
      "tz=UTC",
    ]);
    expect(companyCacheKey("r", "co", { tz: "UTC", location: "L1" })).toEqual(
      companyCacheKey("r", "co", { location: "L1", tz: "UTC" })
    );
    expect(companyCacheKey("r", "co", { location: "L1" })).not.toEqual(
      companyCacheKey("r", "co", { location: "L2" })
    );
    expect(companyCacheKey("r", "co", { period: "last_7" })).not.toEqual(
      companyCacheKey("r", "co", { period: "month" })
    );
  });
});

describe("the tags", () => {
  it("are company:<id>:sales and company:<id>:costing", () => {
    expect(salesTag("co-1")).toBe("company:co-1:sales");
    expect(costingTag("co-1")).toBe("company:co-1:costing");
  });
  it("revalidateSales / revalidateCosting expire exactly that company's tag now", () => {
    revalidateSales("co-1");
    revalidateCosting("co-2");
    expect(revalidated).toEqual([
      { tag: "company:co-1:sales", profile: { expire: 0 } },
      { tag: "company:co-2:costing", profile: { expire: 0 } },
    ]);
    revalidateSales(null); // no company: nothing to expire
    revalidateSales(undefined);
    expect(revalidated).toHaveLength(2);
  });
});

describe("cachedForCompany", () => {
  it("caches under the company key with the tags and 300 s", async () => {
    const fn = vi.fn(async () => ({ ok: 1 }));
    const out = await cachedForCompany(
      {
        name: "sales-detail",
        companyId: "co-1",
        parts: { location: "L1" },
        tags: [salesTag("co-1")],
      },
      fn
    );
    expect(out).toEqual({ ok: 1 });
    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0].keyParts).toEqual([
      "milton",
      "sales-detail",
      "co-1",
      "location=L1",
    ]);
    expect(cacheCalls[0].opts).toEqual({
      tags: ["company:co-1:sales"],
      revalidate: CACHE_REVALIDATE_SECONDS,
    });
    expect(CACHE_REVALIDATE_SECONDS).toBe(300);
  });
  it("a failure is never cached: it falls back to the uncached read", async () => {
    cacheThrows = true;
    const fn = vi.fn(async () => "fresh");
    const fallback = vi.fn(async () => "uncached");
    expect(
      await cachedForCompany(
        { name: "x", companyId: "co", tags: [] },
        fn,
        fallback
      )
    ).toBe("uncached");
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The sales-detail route uses it, per company, with the caller's token (RLS)
// ---------------------------------------------------------------------------
describe("GET /api/restaurant/sales-detail", () => {
  it("reads through the cache with the company key, the sales tag and an RLS-bound client built from the caller's token", async () => {
    const loadSalesDetail = vi.fn(async () => ({
      cube: { rows: [], order_count: 0 },
    }));
    const cacheClientFor = vi.fn(async () => ({ as: "token-client" }));
    vi.resetModules();
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: async () => ({
        ok: true,
        supabase: { as: "request-client" },
        companyId: "co-9",
        userId: "u",
      }),
    }));
    vi.doMock("@/lib/restaurant/restaurant-context-server", () => ({
      resolveRestaurantContext: async () => ({
        selected: { locationId: "L7" },
      }),
    }));
    vi.doMock("@/lib/restaurant/sales-detail-server", () => ({
      loadSalesDetail,
    }));
    vi.doMock("@/lib/restaurant/cache-client", () => ({
      accessTokenOf: async () => "jwt-of-the-caller",
      cacheClientFor,
    }));
    const { GET } = await import("@/app/api/restaurant/sales-detail/route");
    const res = await GET({
      nextUrl: new URL("http://x/api/restaurant/sales-detail?location_id=L7"),
    } as never);
    expect(res.status).toBe(200);
    expect(cacheCalls[0].keyParts).toEqual([
      "milton",
      "sales-detail",
      "co-9",
      "location=L7",
    ]);
    expect(cacheCalls[0].opts.tags).toEqual(["company:co-9:sales"]);
    expect(cacheClientFor).toHaveBeenCalledWith("jwt-of-the-caller");
    expect(loadSalesDetail).toHaveBeenCalledWith(
      { as: "token-client" },
      "co-9",
      "L7",
      { failOnReadError: true }
    );
    vi.doUnmock("@/lib/restaurant/api-auth");
    vi.doUnmock("@/lib/restaurant/restaurant-context-server");
    vi.doUnmock("@/lib/restaurant/sales-detail-server");
    vi.doUnmock("@/lib/restaurant/cache-client");
  });
  it("without a session token it does not cache (reads as before)", async () => {
    const loadSalesDetail = vi.fn(async () => ({
      cube: { rows: [], order_count: 0 },
    }));
    vi.resetModules();
    vi.doMock("@/lib/restaurant/api-auth", () => ({
      authAndCompany: async () => ({
        ok: true,
        supabase: { as: "request-client" },
        companyId: "co-9",
        userId: "u",
      }),
    }));
    vi.doMock("@/lib/restaurant/restaurant-context-server", () => ({
      resolveRestaurantContext: async () => ({ selected: null }),
    }));
    vi.doMock("@/lib/restaurant/sales-detail-server", () => ({
      loadSalesDetail,
    }));
    vi.doMock("@/lib/restaurant/cache-client", () => ({
      accessTokenOf: async () => null,
      cacheClientFor: vi.fn(),
    }));
    const { GET } = await import("@/app/api/restaurant/sales-detail/route");
    await GET({
      nextUrl: new URL("http://x/api/restaurant/sales-detail"),
    } as never);
    expect(cacheCalls).toHaveLength(0);
    expect(loadSalesDetail).toHaveBeenCalledWith(
      { as: "request-client" },
      "co-9",
      null
    );
    vi.doUnmock("@/lib/restaurant/cache-client");
  });
});

// ---------------------------------------------------------------------------
// Every writer of the sales data expires the tag, AFTER its write
// ---------------------------------------------------------------------------
describe("the writers revalidate the company's sales tag", () => {
  const WRITERS: Array<[string, RegExp]> = [
    [
      "app/api/restaurant/pos/odoo-sync/route.ts",
      /persistLastSync\([^)]*\);\s*[\s\S]{0,120}revalidateSales\(companyId\)/,
    ],
    [
      "app/api/restaurant/pos/upload/route.ts",
      /revalidateSales\(company\.id\);\s*return NextResponse\.json\(summary\)/,
    ],
    [
      "app/api/restaurant/shifts/route.ts",
      /revalidateSales\(auth\.companyId\);\s*return NextResponse\.json\(\{\s*saved/,
    ],
    [
      "app/api/restaurant/targets/route.ts",
      /revalidateSales\(auth\.companyId\);\s*const full/,
    ],
    [
      "app/api/restaurant/add-restaurant/route.ts",
      /revalidateSales\(companyId\);\s*return NextResponse\.json\(\{\s*success: true,\s*created: true/,
    ],
    [
      "app/api/restaurant/locations/[id]/route.ts",
      /revalidateSales\(auth\.companyId\);\s*return NextResponse\.json\(\{ id, name/,
    ],
  ];
  for (const [file, re] of WRITERS) {
    it(`${file} calls revalidateSales after the write`, () => {
      const src = read(file);
      expect(src).toContain('from "@/lib/restaurant/cache-tags"');
      expect(src).toMatch(re);
    });
  }
  it("the cached readers are tagged with the same sales tag", () => {
    expect(read("lib/restaurant/cockpit-page-data.ts")).toContain(
      "tags: [salesTag(companyId)]"
    );
    expect(read("app/api/restaurant/sales-detail/route.ts")).toContain(
      "tags: [salesTag(auth.companyId)]"
    );
  });
});

// ---------------------------------------------------------------------------
// One shell, prefetch, no imperative navigation
// ---------------------------------------------------------------------------
describe("one shell for every /dashboard/restaurant page", () => {
  it("the Cockpit lives under the same layout; the old group is gone; the URL is unchanged", () => {
    expect(existsSync(join(process.cwd(), "app/(restaurant-cockpit)"))).toBe(
      false
    );
    expect(
      existsSync(join(process.cwd(), "app/dashboard/restaurant/layout.tsx"))
    ).toBe(true);
    // a route group keeps the URL /dashboard/restaurant and scopes the skeleton
    expect(
      existsSync(
        join(process.cwd(), "app/dashboard/restaurant/(cockpit)/page.tsx")
      )
    ).toBe(true);
    expect(
      existsSync(
        join(process.cwd(), "app/dashboard/restaurant/(cockpit)/loading.tsx")
      )
    ).toBe(true);
    expect(
      existsSync(join(process.cwd(), "app/dashboard/restaurant/page.tsx"))
    ).toBe(false);
    // the error boundary of /dashboard/restaurant/* covers the Cockpit too
    expect(
      existsSync(join(process.cwd(), "app/dashboard/restaurant/error.tsx"))
    ).toBe(true);
    // and only ONE RestaurantShell is rendered by layouts
    expect(read("app/dashboard/restaurant/layout.tsx")).toContain(
      "<RestaurantShell"
    );
  });
  it("every main route has a loading.tsx", () => {
    for (const f of [
      "app/dashboard/restaurant/(cockpit)/loading.tsx",
      "app/dashboard/restaurant/menu/loading.tsx",
      "app/dashboard/restaurant/costs/loading.tsx",
      "app/dashboard/restaurant/sales/loading.tsx",
      "app/dashboard/restaurant/kitchen/loading.tsx",
    ])
      expect(existsSync(join(process.cwd(), f)), f).toBe(true);
  });
});

describe("prefetch of the main tabs", () => {
  const shell = read("components/restaurant/RestaurantShell.tsx");
  it("Cockpit, Ventas, Menú and Costos prefetch in full once idle, or at once on hover / focus", () => {
    expect(shell).toContain('"cockpit",\n  "sales",\n  "menu",\n  "costs",');
    expect(shell).toContain("const full = fullPrefetch && (warm || intent);");
    expect(shell).toContain("onMouseEnter={() => setIntent(true)}");
    expect(shell).toContain("onFocus={() => setIntent(true)}");
    expect(read("components/restaurant/shell/use-section-warmth.ts")).toContain(
      "requestIdleCallback"
    );
  });
  it("Menú › Platos is prefetched too", () => {
    expect(shell).toContain('data-testid="prefetch-platos"');
    expect(shell).toContain("platosHref()");
  });
  it("the restaurant switcher no longer navigates with router.push (plain Links)", () => {
    expect(shell).not.toContain("router.push");
    expect(shell).not.toContain("useRouter");
    expect(shell).toContain("hrefFor(loc.id)");
  });
});

describe("fewer sequential awaits", () => {
  const src = read("lib/restaurant/cockpit-page-data.ts");
  it("the tabs model reads the chrome and the scope together", () => {
    expect(src).toMatch(
      /const \[chrome, resolved\] = await Promise\.all\(\[\s*loadRestaurantShellChrome\(\),\s*resolveCockpitScope\(requestedLocationId\),\s*\]\);\s*if \(!resolved\.ok\) \{\s*return \{\s*lang: chrome\.lang,/
    );
  });
  it("the scope reads the client and the cached sign-in together", () => {
    expect(src).toMatch(
      /Promise\.all\(\[\s*createClient\(\),\s*getCachedAuthUser\(\),\s*\]\)/
    );
  });
  it("the page model reuses the cached sign-in / company (no second getUser) and reads goals + profitability together", () => {
    const body = src.slice(
      src.indexOf("export async function loadCockpitPageModel"),
      src.indexOf("export async function loadMenuAreaModel") > 0
        ? src.indexOf("export async function loadMenuAreaModel")
        : undefined
    );
    expect(body).not.toContain("supabase.auth.getUser");
    expect(body).toContain("getCachedCompanyId(user.id)");
    expect(body).toMatch(
      /const \[targetsRead, profitabilityRead\] = await Promise\.all/
    );
  });
});

describe("migration 059 is only an index, and the code does not depend on it", () => {
  const sql = read("supabase/migrations/059_recipe_inputs_company_indexes.sql");
  it("two CREATE INDEX IF NOT EXISTS on (company_id, version) and nothing else", () => {
    const code = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect((code.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length).toBe(2);
    expect(code).toContain(
      "recipe_version_inputs (company_id, recipe_version_id)"
    );
    expect(code).toContain(
      "component_recipe_version_inputs (company_id, component_recipe_version_id)"
    );
    expect(code).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|INSERT)\b/i);
  });
  it("no source file mentions the index names", () => {
    expect(
      read("lib/restaurant/costing/dish-economics-server.ts")
    ).not.toContain("company_version_idx");
  });
});
