// POST /api/restaurant/recipes/price-catalog
//
// Multipart: file (xlsx), mode = "preview" (default) | "apply",
// decisions = JSON (apply only). Preview never writes. The same file is
// re-read on apply, so the server never trusts prices sent by the client
// except a person's explicit, validated overrides in `decisions`.
//
// Company comes from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  createSupabaseCostWorkbookRepo,
  isWorkbookLimitError,
} from "@/lib/restaurant/cost-workbook";
import {
  applyPriceCatalog,
  parseDecisions,
  planCatalog,
} from "@/lib/restaurant/price-catalog/apply";
import { findCostConflicts } from "@/lib/restaurant/price-catalog/conflicts";
import {
  MAX_CATALOG_FILE_BYTES,
  readCatalogFromBuffer,
} from "@/lib/restaurant/price-catalog/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const NEEDS_039 =
  "Falta aplicar la migración 039 en Supabase antes de guardar la lista de precios.";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Sube el archivo de costos (.xlsx)." },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Sube el archivo de costos (.xlsx)." },
      { status: 400 }
    );
  }
  if (file.size > MAX_CATALOG_FILE_BYTES) {
    return NextResponse.json(
      { error: "El archivo pesa más de 15 MB." },
      { status: 400 }
    );
  }
  const mode = form.get("mode") === "apply" ? "apply" : "preview";

  try {
    const { read, observations, blocks } = readCatalogFromBuffer(
      Buffer.from(await file.arrayBuffer())
    );
    if (!read) {
      return NextResponse.json(
        {
          error:
            "No encontré una lista de precios en este archivo. Busca una hoja con columnas como ITEM, LIBRA, ONZA y PRECIO UNITARIO.",
        },
        { status: 400 }
      );
    }

    let decisions = parseDecisions(null);
    const rawDecisions = form.get("decisions");
    if (typeof rawDecisions === "string" && rawDecisions.trim()) {
      try {
        decisions = parseDecisions(JSON.parse(rawDecisions));
      } catch {
        return NextResponse.json(
          { error: "Las decisiones no tienen un formato válido." },
          { status: 400 }
        );
      }
    }

    if (mode === "preview") {
      const plan = planCatalog(read, decisions);
      const conflicts = findCostConflicts(plan.effective, observations);
      return NextResponse.json({
        sheet: read.sheet,
        rows: read.rows,
        conflicts,
        summary: {
          rows: read.rows.length,
          ready: plan.save.length,
          need_decision: plan.pending.length,
          preparations: plan.preparations,
          conflicts: conflicts.length,
        },
      });
    }

    const repo = createSupabaseCostWorkbookRepo(auth.supabase);
    if (!(await repo.hasPriceCatalog039(auth.companyId))) {
      return NextResponse.json({ error: NEEDS_039 }, { status: 409 });
    }
    const currency =
      (await resolveCompanyCurrency(auth.supabase, auth.companyId)) || "USD";
    const result = await applyPriceCatalog({
      repo,
      companyId: auth.companyId,
      userId: auth.userId,
      currency,
      filename: file.name || "lista-de-precios.xlsx",
      read,
      observations,
      decisions,
      candidateBlocks: blocks,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (isWorkbookLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[recipes/price-catalog]", err);
    return NextResponse.json(
      { error: "No pude procesar la lista de precios." },
      { status: 500 }
    );
  }
}
