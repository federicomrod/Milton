import { describe, expect, it } from "vitest";
import {
  effectiveDateForNewApprovedVersion,
  nextVersionNumber,
  pickApprovedVersion,
  todayUtcDate,
} from "@/lib/restaurant/recipe-versions";

const v = (
  version_number: number,
  status: "approved" | "in_review",
  effective_date: string | null
) => ({
  id: `v${version_number}`,
  recipe_id: "r1",
  menu_item_id: "m1",
  version_number,
  status,
  effective_date,
});

describe("pickApprovedVersion", () => {
  it("uses the first approved version for all loaded history", () => {
    const versions = [v(1, "approved", null)];
    expect(pickApprovedVersion(versions, "2026-07-15")?.id).toBe("v1");
    expect(pickApprovedVersion(versions, "2026-04-01")?.id).toBe("v1");
  });

  it("applies a later approved version only from its effective date", () => {
    const versions = [v(1, "approved", null), v(2, "approved", "2026-10-01")];
    expect(pickApprovedVersion(versions, "2026-07-31")?.id).toBe("v1");
    expect(pickApprovedVersion(versions, "2026-10-01")?.id).toBe("v2");
    expect(pickApprovedVersion(versions, "2026-10-12")?.id).toBe("v2");
  });

  it("keeps the approved version while the next one is in review", () => {
    const versions = [v(1, "approved", null), v(2, "in_review", "2026-10-01")];
    expect(pickApprovedVersion(versions, "2026-10-12")?.id).toBe("v1");
  });

  it("returns null when nothing is approved", () => {
    expect(
      pickApprovedVersion([v(1, "in_review", null)], "2026-10-01")
    ).toBeNull();
  });
});

describe("nextVersionNumber", () => {
  it("increments from the highest version", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(
      nextVersionNumber([{ version_number: 1 }, { version_number: 3 }])
    ).toBe(4);
  });
});

describe("effectiveDateForNewApprovedVersion", () => {
  it("gives the first approved version a NULL date when none is approved yet", () => {
    expect(effectiveDateForNewApprovedVersion([])).toBeNull();
    expect(
      effectiveDateForNewApprovedVersion([v(1, "in_review", null)])
    ).toBeNull();
    expect(
      effectiveDateForNewApprovedVersion([
        v(1, "in_review", null),
        v(2, "in_review", "2026-10-01"),
      ])
    ).toBeNull();
  });

  it("dates a later approved version today so earlier periods stay put", () => {
    expect(effectiveDateForNewApprovedVersion([v(1, "approved", null)])).toBe(
      todayUtcDate()
    );
    expect(
      effectiveDateForNewApprovedVersion([
        v(1, "approved", null),
        v(2, "in_review", "2026-10-01"),
      ])
    ).toBe(todayUtcDate());
  });
});
