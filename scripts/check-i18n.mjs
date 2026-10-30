// Fails when a key is missing, extra or empty in es/en/de, or when a
// {placeholder} differs between languages. tsx is not a dependency, so the
// TypeScript dictionaries are bundled in memory with esbuild (already
// installed with vite) and imported from a data URL.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = await build({
  entryPoints: [path.join(root, "lib/i18n/check.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: { "@": root },
});
const code = out.outputFiles[0].text;
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const problems = mod.checkDictionaries();
if (problems.length) {
  console.error(`i18n check failed (${problems.length}):`);
  for (const p of problems.slice(0, 50)) console.error("  " + p);
  process.exit(1);
}
console.log("i18n check passed");
