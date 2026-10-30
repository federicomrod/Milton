// POST /api/restaurant/recipes/price-catalog
//
// Multipart: file (xlsx), mode = "preview" (default) | "apply",
// decisions = JSON (apply only). Preview never writes. The same file is
// re-read on apply, so the server never trusts prices sent by the client
// except a person's explicit, validated overrides in `decisions`.
//
// Company comes from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { actionableError } from "@/lib/restaurant/actionable-error";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
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
  catalogDecisionsFromDraft,
  loadUploadDraft,
  loadUploadDraftFile,
  updateUploadDraft,
  type DraftDecisions,
} from "@/lib/restaurant/price-catalog/draft";
import {
  MAX_CATALOG_FILE_BYTES,
  readCatalogFromBuffer,
} from "@/lib/restaurant/price-catalog/server";
import { apiDictionary } from "@/lib/restaurant/api-lang";

const apiMsg = async () => (await apiDictionary()).menu.workspace.api;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "prices.edit");
  if (denied) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: (await apiMsg()).uploadCostsFile },
      { status: 400 }
    );
  }
  const mode = form.get("mode") === "apply" ? "apply" : "preview";
  // The file comes with the request, or from the saved draft (draft=1):
  // the draft keeps the file and the person's choices across reloads.
  const fromDraft = form.get("draft") === "1";
  let buffer: Buffer;
  let filename: string;
  let draftDecisions: DraftDecisions | null = null;
  if (fromDraft) {
    const [stored, draft] = await Promise.all([
      loadUploadDraftFile(auth.supabase, auth.companyId),
      loadUploadDraft(auth.supabase, auth.companyId),
    ]);
    if (!stored || !draft) {
      return NextResponse.json(
        { error: (await apiMsg()).fileGone },
        { status: 400 }
      );
    }
    buffer = stored.buffer;
    filename = stored.filename;
    draftDecisions = draft.decisions;
  } else {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: (await apiMsg()).uploadCostsFile },
        { status: 400 }
      );
    }
    if (file.size > MAX_CATALOG_FILE_BYTES) {
      return NextResponse.json(
        { error: (await apiMsg()).fileTooBig },
        { status: 400 }
      );
    }
    buffer = Buffer.from(await file.arrayBuffer());
    filename = file.name || "lista-de-precios.xlsx";
  }

  try {
    const { read, observations, blocks } = readCatalogFromBuffer(buffer);
    if (!read) {
      return NextResponse.json(
        {
          error: (await apiMsg()).catalogNotFound,
        },
        { status: 400 }
      );
    }

    let decisions = parseDecisions(null);
    const rawDecisions = form.get("decisions");
    if (draftDecisions) {
      // Saved server-side as the person chose: the draft is the truth.
      decisions = parseDecisions(
        catalogDecisionsFromDraft(draftDecisions, read.rows)
      );
    } else if (typeof rawDecisions === "string" && rawDecisions.trim()) {
      try {
        decisions = parseDecisions(JSON.parse(rawDecisions));
      } catch {
        return NextResponse.json(
          { error: (await apiMsg()).decisionsInvalid },
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
      return NextResponse.json(
        { error: (await apiMsg()).needsMigration039 },
        { status: 409 }
      );
    }
    const currency =
      (await resolveCompanyCurrency(auth.supabase, auth.companyId)) || "USD";
    const result = await applyPriceCatalog({
      repo,
      companyId: auth.companyId,
      userId: auth.userId,
      currency,
      filename,
      read,
      observations,
      decisions,
      candidateBlocks: blocks,
    });
    if (fromDraft) {
      await updateUploadDraft(auth.supabase, {
        companyId: auth.companyId,
        userId: auth.userId,
        catalog_result: result as unknown as Record<string, unknown>,
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (isWorkbookLimitError(err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const failure = actionableError(
      err,
      (await apiMsg()).catalogProcessFailed,
      "recipes/price-catalog"
    );
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
}
