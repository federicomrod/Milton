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

  it("two undated approved versions: the HIGHEST number, whatever the order of the array", () => {
    const a = [v(1, "approved", null), v(2, "approved", null)];
    const b = [v(2, "approved", null), v(1, "approved", null)];
    expect(pickApprovedVersion(a, "2026-10-12")?.id).toBe("v2");
    expect(pickApprovedVersion(b, "2026-10-12")?.id).toBe("v2");
    expect(
      pickApprovedVersion(
        [
          v(3, "approved", null),
          v(1, "approved", null),
          v(2, "approved", null),
        ],
        "2026-10-12"
      )?.id
    ).toBe("v3");
  });

  it("an undated v3 after a dated v2 wins (v2's date has passed)", () => {
    const versions = [
      v(1, "approved", null),
      v(2, "approved", "2026-09-01"),
      v(3, "approved", null),
    ];
    expect(pickApprovedVersion(versions, "2026-10-12")?.id).toBe("v3");
    expect(pickApprovedVersion([...versions].reverse(), "2026-10-12")?.id).toBe(
      "v3"
    );
  });

  it("a future-dated version only counts once its date arrives", () => {
    const versions = [
      v(1, "approved", null),
      v(2, "approved", null),
      v(3, "approved", "2026-12-01"),
    ];
    expect(pickApprovedVersion(versions, "2026-10-12")?.id).toBe("v2");
    expect(pickApprovedVersion(versions, "2026-11-30")?.id).toBe("v2");
    expect(pickApprovedVersion(versions, "2026-12-01")?.id).toBe("v3");
  });

  it("when every approved version is dated in the future, the lowest number is the base", () => {
    const versions = [
      v(3, "approved", "2999-01-01"),
      v(2, "approved", "2998-01-01"),
    ];
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
