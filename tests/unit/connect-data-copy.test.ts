import { describe, it, expect } from "vitest";
import {
  CONNECT_DATA_COPY,
  CONNECT_OPTIONS,
  DATA_SOURCE_REQUEST_SOURCES,
  UPLOAD_PATH,
  optionKeyForPrimaryPos,
} from "@/lib/restaurant/connect-data-copy";

const allActions = CONNECT_OPTIONS.flatMap((o) => o.actions);
const byId = (id: string) => allActions.find((a) => a.id === id);

describe("connect-data options are honest", () => {
  it("has exactly four options", () => {
    expect(CONNECT_OPTIONS.map((o) => o.key)).toEqual([
      "spreadsheet",
      "revel",
      "odoo",
      "other",
    ]);
  });

  it("spreadsheet and Revel export link to the existing upload tab", () => {
    for (const id of ["spreadsheet_upload", "revel_export"]) {
      const a = byId(id);
      expect(a).toMatchObject({ kind: "link", href: UPLOAD_PATH });
    }
    expect(UPLOAD_PATH).toBe("/dashboard/restaurant/upload");
  });

  it("the spreadsheet card says which format the uploader expects", () => {
    const spreadsheet = CONNECT_OPTIONS.find((o) => o.key === "spreadsheet")!;
    expect(spreadsheet.description).toMatch(/Customer Items/);
    expect(spreadsheet.description).toMatch(/item-level sales format/);
  });

  it("live Revel is 'Coming soon' with a request source", () => {
    expect(byId("revel_live")).toMatchObject({
      kind: "request",
      source: "revel_live",
      badge: "Coming soon",
      label: "Request it",
    });
  });

  it("Odoo is a request (no link, no Odoo connect UI)", () => {
    expect(byId("odoo_setup")).toMatchObject({
      kind: "request",
      source: "odoo",
      label: "Connect Odoo",
    });
    const odoo = CONNECT_OPTIONS.find((o) => o.key === "odoo")!;
    expect(odoo.actions.every((a) => a.kind === "request")).toBe(true);
    expect(odoo.description).toBe(
      "The Milton team connects Odoo for you during the pilot."
    );
    const action = byId("odoo_setup") as {
      badge?: string;
      sentMessage?: string;
    };
    expect(action.badge).toBeUndefined();
    expect(action.sentMessage).toMatch(/Milton team connects Odoo for you/);
    expect(JSON.stringify(odoo)).not.toMatch(/coming soon/i);
  });

  it("every request source is in the API allowlist", () => {
    for (const a of allActions) {
      if (a.kind === "request") {
        expect(DATA_SOURCE_REQUEST_SOURCES).toContain(a.source);
      }
    }
  });

  it("nothing claims to be connected", () => {
    const text = JSON.stringify([CONNECT_OPTIONS, CONNECT_DATA_COPY]);
    expect(text).not.toMatch(/\bconnected\b/i);
    expect(text).not.toMatch(/"status"/);
  });

  it("highlights the card matching onboarding primary_pos", () => {
    expect(optionKeyForPrimaryPos("odoo")).toBe("odoo");
    expect(optionKeyForPrimaryPos("revel")).toBe("revel");
    expect(optionKeyForPrimaryPos("square")).toBe("other");
    expect(optionKeyForPrimaryPos("unknown")).toBeNull();
    expect(optionKeyForPrimaryPos(null)).toBeNull();
  });
});
