// lib/restaurant/connect-data-copy.ts
//
// All copy and option definitions for the minimal "Connect your data"
// screen (R1 item 2, Decision 2), kept in one file like onboarding-copy.ts.
//
// HONESTY RULE: only options that work today link anywhere. Anything not
// built yet is labeled "Coming soon" / "Request" and saves a
// data_source_requests row. No fake "connected" states, no dead buttons.

import type { PosSystemChoice } from "./onboarding-copy";

export const UPLOAD_PATH = "/dashboard/restaurant/upload";
export const DASHBOARD_PATH = "/dashboard/restaurant";

export type DataSourceRequestSource =
  | "odoo"
  | "revel_live"
  | "square"
  | "toast"
  | "other";

export const DATA_SOURCE_REQUEST_SOURCES: readonly DataSourceRequestSource[] = [
  "odoo",
  "revel_live",
  "square",
  "toast",
  "other",
];

export const MAX_REQUEST_DETAILS = 1000;

export type ConnectActionId =
  | "spreadsheet_upload"
  | "revel_export"
  | "revel_live"
  | "odoo_setup"
  | "other_request";

export type ConnectAction =
  | { id: ConnectActionId; kind: "link"; href: string }
  | {
      id: ConnectActionId;
      kind: "request";
      source: DataSourceRequestSource;
      /** Show a «Coming soon» badge. */
      comingSoon?: boolean;
      /** Show an optional note field before sending. */
      note?: boolean;
      /** Show its own confirmation instead of the default one. */
      ownSentMessage?: boolean;
    };

export interface ConnectOption {
  key: "spreadsheet" | "revel" | "odoo" | "other";
  /** onboarding primary_pos values that highlight this card. */
  matchesPos: PosSystemChoice[];
  actions: ConnectAction[];
}

// The texts (titles, descriptions, button labels) live in the `connect`
// dictionary (lib/i18n/{es,en,de}/connect.ts); this file keeps the structure.

export const CONNECT_OPTIONS: readonly ConnectOption[] = [
  {
    key: "spreadsheet",
    matchesPos: [],
    actions: [{ id: "spreadsheet_upload", kind: "link", href: UPLOAD_PATH }],
  },
  {
    key: "revel",
    matchesPos: ["revel"],
    actions: [
      { id: "revel_export", kind: "link", href: UPLOAD_PATH },
      {
        id: "revel_live",
        kind: "request",
        source: "revel_live",
        comingSoon: true,
      },
    ],
  },
  {
    key: "odoo",
    matchesPos: ["odoo"],
    actions: [
      {
        id: "odoo_setup",
        kind: "request",
        source: "odoo",
        note: true,
        ownSentMessage: true,
      },
    ],
  },
  {
    key: "other",
    matchesPos: ["square", "toast", "other"],
    actions: [
      { id: "other_request", kind: "request", source: "other", note: true },
    ],
  },
];

/** Quick picks for the "Other" card (labels: `connect.picks`). */
export const OTHER_QUICK_PICKS: readonly Extract<
  DataSourceRequestSource,
  "square" | "toast" | "other"
>[] = ["square", "toast", "other"];

/** Which option card to highlight for a location's primary_pos. */
export function optionKeyForPrimaryPos(
  primaryPos: string | null | undefined
): ConnectOption["key"] | null {
  if (!primaryPos) return null;
  const match = CONNECT_OPTIONS.find((o) =>
    o.matchesPos.includes(primaryPos as PosSystemChoice)
  );
  return match?.key ?? null;
}
