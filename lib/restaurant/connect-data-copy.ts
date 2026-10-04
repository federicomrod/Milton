// lib/restaurant/connect-data-copy.ts
//
// All copy and option definitions for the minimal "Connect your data"
// screen (R1 item 2, Decision 2), kept in one file like onboarding-copy.ts.
//
// HONESTY RULE: only options that work today link anywhere. Anything not
// built yet is labeled "Coming soon" / "Request" and saves a
// data_source_requests row. No fake "connected" states, no dead buttons.

import { POS_SYSTEM_OPTIONS, type PosSystemChoice } from "./onboarding-copy";

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

export type ConnectAction =
  | { id: string; kind: "link"; label: string; href: string }
  | {
      id: string;
      kind: "request";
      label: string;
      source: DataSourceRequestSource;
      badge?: string;
      /** Show an optional note field before sending. */
      note?: boolean;
      /** Confirmation shown after a successful request (default: COPY.requestSent). */
      sentMessage?: string;
    };

export interface ConnectOption {
  key: "spreadsheet" | "revel" | "odoo" | "other";
  title: string;
  description: string;
  /** onboarding primary_pos values that highlight this card. */
  matchesPos: PosSystemChoice[];
  actions: ConnectAction[];
}

export const CONNECT_DATA_COPY = {
  header: "Connect your data so Milton can show real numbers",
  subheader:
    "Pick how your sales data will reach Milton. You can change this later.",
  skip: "Skip for now → dashboard",
  recommended: "Matches your POS",
  requestSent: "Thanks — we'll get back to you",
  requestError: "Something went wrong. Please try again.",
  notePlaceholder: "Anything we should know? (optional)",
  otherTextLabel: "What holds your sales data today?",
  otherTextPlaceholder: "e.g. our POS is called … / we keep sales in …",
  otherSubmit: "Send",
  sendRequest: "Send request",
} as const;

export const CONNECT_OPTIONS: readonly ConnectOption[] = [
  {
    key: "spreadsheet",
    title: "Excel / spreadsheet upload",
    description:
      "Works today. Heads up: the uploader currently expects the item-level sales format (the Revel “Customer Items” columns), so not every spreadsheet will import yet.",
    matchesPos: [],
    actions: [
      {
        id: "spreadsheet_upload",
        kind: "link",
        label: "Upload a spreadsheet",
        href: UPLOAD_PATH,
      },
    ],
  },
  {
    key: "revel",
    title: "Revel",
    description:
      "Upload a Revel “Customer Items” export today. Live Revel sync is coming soon — request it and we'll let you know.",
    matchesPos: ["revel"],
    actions: [
      {
        id: "revel_export",
        kind: "link",
        label: "Upload a Revel export",
        href: UPLOAD_PATH,
      },
      {
        id: "revel_live",
        kind: "request",
        label: "Request it",
        source: "revel_live",
        badge: "Coming soon",
      },
    ],
  },
  {
    key: "odoo",
    title: "Odoo",
    description: "The Milton team connects Odoo for you during the pilot.",
    matchesPos: ["odoo"],
    actions: [
      {
        id: "odoo_setup",
        kind: "request",
        label: "Connect Odoo",
        source: "odoo",
        note: true,
        sentMessage:
          "Thanks! The Milton team connects Odoo for you. We'll contact you to set it up.",
      },
    ],
  },
  {
    key: "other",
    title: "Other / tell us what holds your data",
    description:
      "Using something else? Tell us what holds your sales data and we'll look into it.",
    matchesPos: ["square", "toast", "other"],
    actions: [
      {
        id: "other_request",
        kind: "request",
        label: "Send",
        source: "other",
        note: true,
      },
    ],
  },
];

/** Quick picks for the "Other" card, reusing the onboarding POS labels. */
export const OTHER_QUICK_PICKS: {
  value: Extract<DataSourceRequestSource, "square" | "toast" | "other">;
  label: string;
}[] = POS_SYSTEM_OPTIONS.filter((o) =>
  ["square", "toast", "other"].includes(o.value)
).map((o) => ({
  value: o.value as "square" | "toast" | "other",
  label: o.label,
}));

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
