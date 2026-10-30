// lib/i18n/check.ts — shared by tests/unit/i18n-keys.test.ts and
// scripts/check-i18n.mjs. Returns human-readable problems; empty = OK.

import { de } from "./de";
import { en } from "./en";
import { es } from "./es";

type Leaf = { path: string; value: string };

function leaves(node: unknown, path: string, out: Leaf[]): Leaf[] {
  if (typeof node === "string") out.push({ path, value: node });
  else if (Array.isArray(node))
    node.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node))
      leaves(v, path ? `${path}.${k}` : k, out);
  else out.push({ path, value: "" });
  return out;
}

function placeholders(s: string): string {
  return [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(",");
}

export function checkDictionaries(
  langs: Record<string, unknown> = { es, en, de }
): string[] {
  const problems: string[] = [];
  const flat = Object.fromEntries(
    Object.entries(langs).map(([l, d]) => [
      l,
      new Map(leaves(d, "", []).map((x) => [x.path, x.value])),
    ])
  );
  const all = new Set(Object.values(flat).flatMap((m) => [...m.keys()]));
  for (const key of [...all].sort()) {
    for (const [l, m] of Object.entries(flat)) {
      if (!m.has(key)) problems.push(`${l}: missing key ${key}`);
      else if (m.get(key)!.trim() === "")
        problems.push(`${l}: empty string at ${key}`);
    }
    const ref = flat.es?.get(key);
    if (ref === undefined) continue;
    for (const [l, m] of Object.entries(flat)) {
      const v = m.get(key);
      if (v !== undefined && placeholders(v) !== placeholders(ref))
        problems.push(`${l}: placeholders differ from es at ${key}`);
    }
  }
  return problems;
}
