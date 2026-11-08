// ONE import review: a changeset grouped by destination month, built only from
// the database's preview, and one request that applies it. Synthetic data only.
import { describe, expect, it } from "vitest";
import type {
  PreviewKey,
  UploadPreview,
} from "@/lib/restaurant/fixed-cost-commands";
import type { DraftLine } from "@/lib/restaurant/fixed-cost-upload";
import {
  approvalBody,
  buildReview,
  changedRows,
  monthUnchanged,
  rowAfter,
  undecided,
} from "@/lib/restaurant/fixed-cost-import-review";
import { NOV, OCT } from "./fixtures/fixed-cost-redesign";

const key = (
  category: PreviewKey["category"],
  cents: number,
  extra: Partial<PreviewKey> = {}
): PreviewKey => ({
  key: `loc-1|${OCT}|${category}`,
  loc: "loc-1",
  month: OCT,
  category,
  kind: "new",
  version: 0,
  old_cents: null,
  detail_state: null,
  existing_items: [],
  incoming_cents: cents,
  add_total_cents: cents,
  duplicate_line_ids: [],
  lines: [{ id: `l-${category}`, raw: `${category} · x`, cents }],
  ...extra,
});

const preview = (keys: PreviewKey[]): UploadPreview => ({
  draft_id: "d1",
  draft_version: 1007,
  file_name: "octubre.xlsx",
  same_file_seen_before: false,
  keys,
});

const dl = (id: string, extra: Partial<DraftLine> = {}): DraftLine => ({
  id,
  raw: `${id} · x`,
  category: "planilla",
  amount: 1,
  month: OCT,
  scope: { kind: "restaurant", locationId: "loc-1" },
  from: "file",
  status: "pending",
  ...extra,
});

describe("a multi-category October file", () => {
  const p = preview([
    key("planilla", 2140000),
    key("alquiler", 650000),
    key("servicios", 490000, {
      lines: ["Electricidad", "Agua", "Internet", "Seguro", "Gas"].map(
        (n, i) => ({
          id: `s${i}`,
          raw: `${n} · x`,
          cents: [180000, 65000, 145000, 10000, 90000][i],
        })
      ),
    }),
    key("otros", 12000),
  ]);
  const review = buildReview([], p);

  it("groups by month and lists categories in the display order, before and after", () => {
    expect(review.groups).toHaveLength(1);
    expect(review.groups[0].month).toBe(OCT);
    expect(review.groups[0].rows.map((r) => r.category)).toEqual([
      "planilla",
      "alquiler",
      "servicios",
      "otros",
    ]);
    const sum = review.groups[0].rows.reduce(
      (t, r) => t + (rowAfter(r, undefined) ?? 0),
      0
    );
    expect(sum).toBe(32920);
    expect(review.groups[0].rows[0].before).toBeNull();
  });

  it("builds ONE request with every line, the reviewed versions and no choices", () => {
    const body = approvalBody(review, p, {}, "cmd-1");
    expect(body.draftId).toBe("d1");
    expect(body.draftVersion).toBe(1007);
    expect(body.commandKey).toBe("cmd-1");
    expect(body.lineIds).toHaveLength(8);
    expect(body.decisions).toEqual({});
    expect(Object.keys(body.expected)).toHaveLength(4);
  });
});

describe("destinations", () => {
  it("an October file and a November line are grouped by month, oldest first", () => {
    const r = buildReview(
      [],
      preview([
        key("planilla", 100, {
          key: `loc-1|${NOV}|planilla`,
          month: NOV,
          lines: [{ id: "n1", raw: "n", cents: 100 }],
        }),
        key("alquiler", 200),
      ])
    );
    expect(r.groups.map((g) => g.month)).toEqual([OCT, NOV]);
  });
});

describe("overlaps are asked once, inline", () => {
  const overlap = key("alquiler", 700000, {
    kind: "overlap",
    old_cents: 650000,
    add_total_cents: 1350000,
    version: 1003,
    detail_state: "legacy_total",
  });
  const p = preview([overlap, key("otros", 12000)]);
  const review = buildReview([], p);

  it("waits for a choice and shows both outcomes", () => {
    const row = review.groups[0].rows.find((r) => r.category === "alquiler")!;
    expect(row.needsChoice).toBe(true);
    expect(rowAfter(row, undefined)).toBeNull();
    expect(rowAfter(row, "replace")).toBe(7000);
    expect(rowAfter(row, "add")).toBe(13500);
    expect(undecided(review, {})).toHaveLength(1);
    expect(undecided(review, { [overlap.key]: "replace" })).toHaveLength(0);
  });

  it("sends the choice for every line of the key", () => {
    const body = approvalBody(review, p, { [overlap.key]: "add" }, "k");
    expect(body.decisions).toEqual({ "l-alquiler": "add" });
  });
});

describe("exact reupload", () => {
  it("is a no-op row: nothing changes and it is not counted as a change", () => {
    const p = preview([
      key("planilla", 2140000, { kind: "noop", old_cents: 2140000 }),
    ]);
    const r = buildReview([], p);
    expect(r.groups[0].rows[0].kind).toBe("noop");
    expect(rowAfter(r.groups[0].rows[0], undefined)).toBe(21400);
    expect(changedRows(r, {})).toEqual([]);
  });

  it("an overlap resolved to the same amount is still a decision, not a silent skip", () => {
    const p = preview([
      key("planilla", 2140000, {
        kind: "overlap",
        old_cents: 2140000,
        add_total_cents: 4280000,
      }),
    ]);
    const r = buildReview([], p);
    expect(undecided(r, {})).toHaveLength(1);
    expect(changedRows(r, { [p.keys[0].key]: "replace" })).toHaveLength(0);
    expect(changedRows(r, { [p.keys[0].key]: "add" })).toHaveLength(1);
  });
});

describe("a continuing file", () => {
  it("adds only the new lines to what this file already recorded", () => {
    const p = preview([
      key("servicios", 100000, {
        kind: "continue",
        old_cents: 400000,
        add_total_cents: 500000,
      }),
    ]);
    const row = buildReview([], p).groups[0].rows[0];
    expect(row.needsChoice).toBe(false);
    expect(row.after).toBe(5000);
  });
});

describe("unresolved lines are listed, never silently dropped", () => {
  it("names each with its reason", () => {
    const lines = [
      dl("ok"),
      dl("nocat", { category: null }),
      dl("noamt", { amount: null }),
      dl("nomonth", { month: null }),
      dl("noresto", { scope: null }),
      dl("done", { status: "approved" }),
    ];
    const p = preview([
      key("planilla", 100, { lines: [{ id: "ok", raw: "ok", cents: 100 }] }),
    ]);
    const r = buildReview(lines, p);
    expect(r.unresolved.map((u) => [u.id, u.reason])).toEqual([
      ["nocat", "category"],
      ["noamt", "amount"],
      ["nomonth", "month"],
      ["noresto", "restaurant"],
    ]);
  });

  it("a duplicate tax rate is unresolved and not in the changeset", () => {
    const p = preview([
      key("impuestos", 1300, {
        kind: "invalid_duplicate_tax",
        lines: [{ id: "t1", raw: "IVA", cents: 1300 }],
      }),
    ]);
    const r = buildReview([dl("t1", { category: "impuestos" })], p);
    expect(r.groups).toEqual([]);
    expect(r.unresolved[0].reason).toBe("duplicate_tax");
  });
});

describe("«the month on screen did not change» is only said when proven", () => {
  const cats = [
    { month: OCT, location_id: "loc-1", outcome: "created" },
    { month: OCT, location_id: "loc-1", outcome: "replaced" },
  ];
  it("true when no category of that month and scope changed", () => {
    expect(monthUnchanged(NOV, "loc-1", cats)).toBe(true);
  });
  it("false when any category of it changed, or when another scope is asked", () => {
    expect(monthUnchanged(OCT, "loc-1", cats)).toBe(false);
    expect(
      monthUnchanged(NOV, "loc-1", [
        ...cats,
        { month: NOV, location_id: "loc-1", outcome: "added" },
      ])
    ).toBe(false);
  });
  it("an unchanged category does not count as a change", () => {
    expect(
      monthUnchanged(OCT, "loc-1", [
        { month: OCT, location_id: "loc-1", outcome: "unchanged" },
      ])
    ).toBe(true);
  });
});
