// scripts/briefing-dry-run.ts
//
// READ-ONLY dry run of the automatic briefing's SALES part: builds the same
// context the 07:00 email uses (trusted server read, service role) and prints
// only the dated sales facts, so they can be compared with the Cockpit on
// staging before a release. It does NOT send an email, does NOT run the Odoo
// sync and writes nothing to the database.
//
//   npm run briefing:dry-run -- <company_id>
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the process
// environment. Never prints keys, urls or env values.

import { createClient } from "@supabase/supabase-js";
import { buildBriefingContext } from "../lib/restaurant/briefing-context";

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    console.error("Uso: npm run briefing:dry-run -- <company_id>");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno."
    );
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ctx = await buildBriefingContext(admin, companyId, null, {
    serverTrusted: true,
  });

  const facts = ctx.sales_periods?.facts ?? [];
  console.log("Ventas con fecha (lo que vería el correo de las 7:00):");
  if (facts.length === 0)
    console.log("  (sin periodos: Sin datos para comparar)");
  for (const fact of facts) console.log(`  ${fact}`);
  console.log(
    `Estado del sync previo: ${
      ctx.sync_status
        ? JSON.stringify(ctx.sync_status)
        : "no aplica en esta corrida (no se ejecutó el sync)"
    }`
  );
}

main().catch((err) => {
  console.error(
    "briefing-dry-run falló:",
    err instanceof Error ? err.name : "error desconocido"
  );
  process.exit(1);
});
