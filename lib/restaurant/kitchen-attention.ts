// lib/restaurant/kitchen-attention.ts
//
// Reads the Kitchen needs-attention bundle. Prefers the 034 RPC
// (one scoped JSON payload). Falls back to RLS SELECTs when the
// function is not on the database yet. Never returns Telegram ids.

import { UPLOAD_AUTHOR_NAME } from "@/lib/restaurant/recipe-upload/constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import { getLocalMoment } from "@/lib/restaurant/email/scheduler";
import { logCockpitTiming } from "@/lib/restaurant/cockpit-timing";
import type { InclusiveDateRange } from "@/lib/restaurant/cockpit-period";
import type {
  KitchenDraftEvent,
  KitchenEventBundle,
  KitchenReportEvent,
  KitchenReportType,
  KitchenStaffRow,
} from "@/lib/restaurant/kitchen-insights";

export const KITCHEN_ATTENTION_RPC = "kitchen_attention_feed";

const REPORT_TYPES = new Set<KitchenReportType>([
  "running_out",
  "86",
  "waste",
  "unclassified",
]);

export function emptyKitchenBundle(): KitchenEventBundle {
  return { reports: [], drafts: [], staff: [] };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function localKitchenInstant(
  iso: string,
  timezone: string
): {
  dateKey: string;
  hour: number | null;
  minute: number | null;
} {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    return { dateKey: "", hour: null, minute: null };
  }
  const tz = normalizeTimezone(timezone) ?? "UTC";
  const local = getLocalMoment(instant, tz);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const minuteRaw = parts.find((p) => p.type === "minute")?.value;
  const minute = minuteRaw != null ? Number(minuteRaw) : 0;
  return {
    dateKey: local.dateKey,
    hour: local.hour,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function asReportType(value: unknown): KitchenReportType | null {
  return typeof value === "string" &&
    REPORT_TYPES.has(value as KitchenReportType)
    ? (value as KitchenReportType)
    : null;
}

function parseReport(
  row: Record<string, unknown>,
  timezone: string
): KitchenReportEvent | null {
  const id = str(row.id);
  const location_id = str(row.location_id);
  const staff_id = str(row.staff_id);
  const report_type = asReportType(row.report_type);
  const created_at = str(row.created_at);
  if (!id || !location_id || !staff_id || !report_type || !created_at) {
    return null;
  }
  const local =
    str(row.local_date) && num(row.local_hour) != null
      ? {
          dateKey: str(row.local_date)!,
          hour: num(row.local_hour),
          minute: num(row.local_minute) ?? 0,
        }
      : localKitchenInstant(created_at, timezone);
  const media =
    row.media_kind === "photo" || row.media_kind === "voice"
      ? row.media_kind
      : null;
  return {
    id,
    location_id,
    staff_id,
    staff_name: str(row.staff_name) ?? "",
    report_type,
    text: str(row.text),
    media_kind: media,
    created_at,
    resolved_at: str(row.resolved_at),
    local_date: local.dateKey,
    local_hour: local.hour,
    local_minute: local.minute,
  };
}

function parseDraft(
  row: Record<string, unknown>,
  timezone: string
): KitchenDraftEvent | null {
  const id = str(row.id);
  const created_at = str(row.created_at);
  const status =
    row.status === "awaiting_portions" || row.status === "draft"
      ? row.status
      : null;
  if (!id || !created_at || !status) return null;
  const local =
    str(row.local_date) && num(row.local_hour) != null
      ? {
          dateKey: str(row.local_date)!,
          hour: num(row.local_hour),
          minute: num(row.local_minute) ?? 0,
        }
      : localKitchenInstant(created_at, timezone);
  return {
    id,
    dish_name: str(row.dish_name) ?? "",
    portions:
      typeof row.portions === "number" && Number.isInteger(row.portions)
        ? row.portions
        : null,
    status,
    staff_name: str(row.staff_name) ?? "",
    created_at,
    local_date: local.dateKey,
    local_hour: local.hour,
    local_minute: local.minute,
    has_photo: row.has_photo === true,
  };
}

/** The «Archivo subido» author row of file uploads is not a cook. */
function isUploadAuthor(row: { display_name: string }): boolean {
  return row.display_name === UPLOAD_AUTHOR_NAME;
}

function parseStaff(row: Record<string, unknown>): KitchenStaffRow | null {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    display_name: str(row.display_name) ?? "",
    is_active: row.is_active !== false,
  };
}

export function parseKitchenAttentionPayload(
  raw: unknown,
  timezone: string
): KitchenEventBundle {
  if (!raw || typeof raw !== "object") return emptyKitchenBundle();
  const row = raw as Record<string, unknown>;
  const reports = Array.isArray(row.reports)
    ? row.reports.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const parsed = parseReport(item as Record<string, unknown>, timezone);
        return parsed ? [parsed] : [];
      })
    : [];
  const drafts = Array.isArray(row.drafts)
    ? row.drafts.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const parsed = parseDraft(item as Record<string, unknown>, timezone);
        return parsed ? [parsed] : [];
      })
    : [];
  const staff = Array.isArray(row.staff)
    ? row.staff.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const parsed = parseStaff(item as Record<string, unknown>);
        return parsed && !isUploadAuthor(parsed) ? [parsed] : [];
      })
    : [];
  return { reports, drafts, staff };
}

function isMissingRpc(message: string | undefined): boolean {
  if (!message) return false;
  return /kitchen_attention_feed|could not find the function|schema cache/i.test(
    message
  );
}

function isMissingResolvedColumn(message: string | undefined): boolean {
  if (!message) return false;
  return /resolved_at|column/i.test(message);
}

export async function fetchKitchenAttentionBundle(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    locationId: string | null;
    period: InclusiveDateRange;
    timezone: string;
  }
): Promise<{ bundle: KitchenEventBundle; source: "rpc" | "rows" | "denied" }> {
  const started = Date.now();
  const timezone = normalizeTimezone(input.timezone) ?? "UTC";
  const rpc = await supabase.rpc(KITCHEN_ATTENTION_RPC, {
    p_company_id: input.companyId,
    p_location_id: input.locationId,
    p_from: input.period.from,
    p_to: input.period.to,
    p_timezone: timezone,
  });
  if (!rpc.error && rpc.data != null) {
    const bundle = parseKitchenAttentionPayload(rpc.data, timezone);
    logCockpitTiming("kitchen-attention", {
      ms: Date.now() - started,
      source: "rpc",
      reports: bundle.reports.length,
      drafts: bundle.drafts.length,
    });
    return { bundle, source: "rpc" };
  }
  if (rpc.error && !isMissingRpc(rpc.error.message)) {
    console.error("[kitchen-attention] rpc failed:", rpc.error.message);
    if (/not a member|permission|denied/i.test(rpc.error.message)) {
      logCockpitTiming("kitchen-attention", {
        ms: Date.now() - started,
        source: "denied",
      });
      return { bundle: emptyKitchenBundle(), source: "denied" };
    }
  }

  const fallback = await fetchKitchenAttentionViaRls(supabase, {
    companyId: input.companyId,
    locationId: input.locationId,
    period: input.period,
    timezone,
  });
  logCockpitTiming("kitchen-attention", {
    ms: Date.now() - started,
    source: "rows",
    reports: fallback.reports.length,
    drafts: fallback.drafts.length,
  });
  return { bundle: fallback, source: "rows" };
}

async function fetchKitchenAttentionViaRls(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    locationId: string | null;
    period: InclusiveDateRange;
    timezone: string;
  }
): Promise<KitchenEventBundle> {
  const reportSelectWithResolved =
    "id, location_id, staff_id, report_type, text, media_kind, created_at, resolved_at";
  const reportSelectBare =
    "id, location_id, staff_id, report_type, text, media_kind, created_at";

  let reportQuery = supabase
    .from("kitchen_reports")
    .select(reportSelectWithResolved)
    .eq("company_id", input.companyId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (input.locationId)
    reportQuery = reportQuery.eq("location_id", input.locationId);

  let reportsRes: {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  } = await reportQuery;
  if (reportsRes.error && isMissingResolvedColumn(reportsRes.error.message)) {
    let retry = supabase
      .from("kitchen_reports")
      .select(reportSelectBare)
      .eq("company_id", input.companyId)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (input.locationId) retry = retry.eq("location_id", input.locationId);
    reportsRes = await retry;
  }
  if (reportsRes.error) {
    console.error("[kitchen-attention] reports:", reportsRes.error.message);
    return emptyKitchenBundle();
  }

  let draftQuery = supabase
    .from("kitchen_recipe_drafts")
    .select(
      "id, dish_name, portions, status, created_at, staff_id, kitchen_report_id"
    )
    .eq("company_id", input.companyId)
    .in("status", ["draft", "awaiting_portions"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (input.locationId)
    draftQuery = draftQuery.eq("location_id", input.locationId);
  const draftsRes = await draftQuery;
  if (draftsRes.error) {
    console.error("[kitchen-attention] drafts:", draftsRes.error.message);
  }

  let staffQuery = supabase
    .from("kitchen_staff")
    .select("id, display_name, is_active")
    .eq("company_id", input.companyId);
  if (input.locationId)
    staffQuery = staffQuery.eq("location_id", input.locationId);
  const staffRes = await staffQuery;
  if (staffRes.error) {
    console.error("[kitchen-attention] staff:", staffRes.error.message);
  }

  const staffRows = (staffRes.data ?? []).flatMap((row) => {
    const parsed = parseStaff(row as Record<string, unknown>);
    return parsed ? [parsed] : [];
  });
  const staffNames = new Map(
    staffRows.map((row) => [row.id, row.display_name])
  );

  const reports = (reportsRes.data ?? []).flatMap((row) => {
    const parsed = parseReport(
      {
        ...(row as Record<string, unknown>),
        staff_name:
          staffNames.get(String((row as { staff_id?: string }).staff_id)) ?? "",
      },
      input.timezone
    );
    return parsed ? [parsed] : [];
  });

  const inWindowOrOpen = reports.filter((row) => {
    if (
      row.local_date &&
      row.local_date >= input.period.from &&
      row.local_date <= input.period.to
    ) {
      return true;
    }
    return (
      (row.report_type === "running_out" || row.report_type === "86") &&
      !row.resolved_at
    );
  });

  const photoReportIds = new Set(
    reports.filter((row) => row.media_kind === "photo").map((row) => row.id)
  );
  const drafts = (draftsRes.data ?? []).flatMap((row) => {
    const parsed = parseDraft(
      {
        ...(row as Record<string, unknown>),
        staff_name:
          staffNames.get(String((row as { staff_id?: string }).staff_id)) ?? "",
        has_photo: photoReportIds.has(
          String(
            (row as { kitchen_report_id?: string | null }).kitchen_report_id ??
              ""
          )
        ),
      },
      input.timezone
    );
    return parsed ? [parsed] : [];
  });

  return {
    reports: inWindowOrOpen,
    drafts,
    staff: staffRows.filter((row) => !isUploadAuthor(row)),
  };
}
