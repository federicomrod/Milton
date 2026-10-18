// Guard: a server component cannot CALL a function exported from a "use client"
// module (it can only render components from one). Next throws at request time:
//   "Attempted to call formatMoney() from the server but formatMoney is on the client."
// Vitest does not enforce that boundary, so unit tests and the build stay green
// while the page crashes in production. This scans the source instead.
//
// Rule: a file WITHOUT "use client" must not import a non-type, lower-case
// (function) export from a "use client" module and call it (`name(`).
// Hooks (`use*`) are allowed only in files that are themselves reachable only
// from client files (every importer is a client file, or such a file).
// Put shared pure helpers in a plain module (lib/…), never in a client component.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";

const ROOT = process.cwd();
const DIRS = ["app", "lib", "components"];
const EXT = [".ts", ".tsx"];

/** Explicit, commented allowlist: «file → names», each with the reason. */
const ALLOWLIST: Record<string, string[]> = {
  // (empty on purpose: add an entry with a comment only if a server file
  //  really must call such a function — it never should)
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.some((e) => name.endsWith(e)) && !name.endsWith(".d.ts"))
      out.push(p);
  }
  return out;
}

// Comment lines are consumed WHOLE (the lookahead stops the regex from ending a
// comment early and mistaking a quoted "use client" inside it for the directive).
const CLIENT_RE =
  /^(?:\s*(?:\/\/[^\n]*(?=\n|$)|\/\*[\s\S]*?\*\/))*\s*["']use client["']/;
export const isClientSource = (src: string) => CLIENT_RE.test(src);

interface Imp {
  from: string;
  /** local names of NON-type named imports */
  names: string[];
}
function importsOf(src: string): Imp[] {
  const out: Imp[] = [];
  const re = /import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) continue; // import type {…}
    const clause = m[2];
    const braces = /\{([\s\S]*)\}/.exec(clause)?.[1];
    if (!braces) continue;
    const names = braces
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !/^type\s/.test(s))
      .map((s) => s.split(/\s+as\s+/).pop() as string);
    out.push({ from: m[3], names });
  }
  return out;
}

type Files = Map<string, string>; // path (posix, relative to ROOT) -> source

function resolveModule(
  files: Files,
  importer: string,
  spec: string
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith("."))
    base = relative(ROOT, resolve(ROOT, dirname(importer), spec))
      .split("\\")
      .join("/");
  else return null;
  for (const cand of [
    base,
    ...EXT.map((e) => base + e),
    ...EXT.map((e) => `${base}/index${e}`),
  ]) {
    if (files.has(cand)) return cand;
  }
  return null;
}

/** Violations: [file, name] where a non-client file calls a client module's function. */
export function findServerCallsToClientFns(
  files: Files
): Array<[string, string, string]> {
  const client = new Set(
    [...files].filter(([, s]) => isClientSource(s)).map(([p]) => p)
  );
  // who imports whom (for the "only reachable from client files" rule)
  const importers = new Map<string, Set<string>>();
  for (const [p, s] of files)
    for (const imp of importsOf(s)) {
      const target = resolveModule(files, p, imp.from);
      if (target)
        (
          importers.get(target) ?? importers.set(target, new Set()).get(target)!
        ).add(p);
    }
  const clientReachable = new Set<string>(client);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [p] of files) {
      if (clientReachable.has(p)) continue;
      const who = importers.get(p);
      if (
        who &&
        who.size > 0 &&
        [...who].every((i) => clientReachable.has(i))
      ) {
        clientReachable.add(p);
        changed = true;
      }
    }
  }
  const out: Array<[string, string, string]> = [];
  for (const [p, src] of files) {
    if (client.has(p)) continue;
    const body = src.replace(/import\s+[^;]*?\s+from\s+["'][^"']+["'];?/g, "");
    for (const imp of importsOf(src)) {
      const target = resolveModule(files, p, imp.from);
      if (!target || !client.has(target)) continue;
      for (const name of imp.names) {
        if (!/^[a-z_$]/.test(name)) continue; // components / types / constants in PascalCase
        const isHook = /^use[A-Z0-9]/.test(name);
        if (isHook && clientReachable.has(p)) continue;
        if (ALLOWLIST[p]?.includes(name)) continue;
        if (
          new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}\\s*\\(`).test(
            body
          )
        )
          out.push([p, name, target]);
      }
    }
  }
  return out;
}

function loadRepo(): Files {
  const files: Files = new Map();
  for (const d of DIRS)
    for (const f of walk(join(ROOT, d)))
      files.set(
        relative(ROOT, f).split("\\").join("/"),
        readFileSync(f, "utf8")
      );
  return files;
}

describe("a server file never calls a function exported from a client module", () => {
  it("the repo is clean (app/, lib/, components/)", () => {
    const bad = findServerCallsToClientFns(loadRepo());
    expect(
      bad.map(([f, n, t]) => `${f} calls ${n}() from client module ${t}`)
    ).toEqual([]);
  });

  it("FAILS on the old Costos page: formatMoney() called from the server, exported by a client module", () => {
    const files: Files = new Map([
      [
        "components/restaurant/costs/CostsArea.tsx",
        `// header comment\n\n"use client";\nexport function formatMoney(n: number | null) { return String(n); }\nexport function CostsKpiCard() { return null; }\n`,
      ],
      [
        "app/dashboard/restaurant/costs/page.tsx",
        `import { CostsKpiCard, formatMoney } from "@/components/restaurant/costs/CostsArea";\nexport default async function P() { return <CostsKpiCard value={formatMoney(1)} />; }\n`,
      ],
    ]);
    expect(findServerCallsToClientFns(files)).toEqual([
      [
        "app/dashboard/restaurant/costs/page.tsx",
        "formatMoney",
        "components/restaurant/costs/CostsArea.tsx",
      ],
    ]);
  });

  it("is fine once the helper lives in a plain module; rendering a client component is always fine", () => {
    const files: Files = new Map([
      [
        "lib/restaurant/costs-format.ts",
        `export function formatMoney(n: number) { return String(n); }\n`,
      ],
      [
        "components/x/CostsArea.tsx",
        `"use client";\nimport { formatMoney } from "@/lib/restaurant/costs-format";\nexport function CostsKpiCard() { return formatMoney(1); }\n`,
      ],
      [
        "app/p/page.tsx",
        `import { CostsKpiCard } from "@/components/x/CostsArea";\nimport { formatMoney } from "@/lib/restaurant/costs-format";\nexport default function P() { return <CostsKpiCard value={formatMoney(1)} />; }\n`,
      ],
    ]);
    expect(findServerCallsToClientFns(files)).toEqual([]);
  });

  it("type-only imports and constants are not calls", () => {
    const files: Files = new Map([
      [
        "components/x/C.tsx",
        `"use client";\nexport type Row = { a: number };\nexport const LIMIT = 3;\nexport function helper() {}\n`,
      ],
      [
        "app/p/page.tsx",
        `import type { Row } from "@/components/x/C";\nimport { type Row as R2, LIMIT } from "@/components/x/C";\nexport default function P() { return LIMIT; }\n`,
      ],
    ]);
    expect(findServerCallsToClientFns(files)).toEqual([]);
  });

  it("hooks: allowed in a file only reachable from client files, not in a server file", () => {
    const client = [
      "components/x/ctx.tsx",
      `"use client";\nexport function useUser() { return 1; }\n`,
    ] as const;
    const onlyClient: Files = new Map([
      client,
      [
        "lib/hooks/useReportData.ts",
        `import { useUser } from "@/components/x/ctx";\nexport function useReportData() { return useUser(); }\n`,
      ],
      [
        "components/x/Panel.tsx",
        `"use client";\nimport { useReportData } from "@/lib/hooks/useReportData";\nexport function Panel() { return useReportData(); }\n`,
      ],
    ]);
    expect(findServerCallsToClientFns(onlyClient)).toEqual([]);
    const alsoServer: Files = new Map([
      ...onlyClient,
      [
        "app/p/page.tsx",
        `import { useReportData } from "@/lib/hooks/useReportData";\nexport default function P() { return useReportData(); }\n`,
      ],
    ]);
    expect(findServerCallsToClientFns(alsoServer).map((v) => v[1])).toEqual([
      "useUser",
    ]);
    const direct: Files = new Map([
      client,
      [
        "app/p/page.tsx",
        `import { useUser } from "@/components/x/ctx";\nexport default function P() { return useUser(); }\n`,
      ],
    ]);
    expect(findServerCallsToClientFns(direct).map((v) => v[1])).toEqual([
      "useUser",
    ]);
  });

  it("detects the 'use client' directive after comments only", () => {
    expect(
      isClientSource(`// NOT a "use client" module\nexport const a = 1;`)
    ).toBe(false);
    expect(
      isClientSource(`// a\n/* b */\n"use client";\nimport x from "y";`)
    ).toBe(true);
    expect(isClientSource(`import x from "y";\n"use client";`)).toBe(false);
    expect(isClientSource(`export const a = 1;`)).toBe(false);
  });
});
