// R1-15f: targets are prepared once per array; a new array (groups changed) is prepared again.
import { describe, expect, it } from "vitest";
import {
  suggestGroup,
  type SuggestTarget,
} from "@/lib/restaurant/groups/suggest";

describe("suggestGroup preparation cache", () => {
  const dishes: SuggestTarget[] = [
    { id: "1", name: "Churrasco Típico", kind: "dish" },
    { id: "2", name: "Sopa de Casa", kind: "dish" },
  ];
  it("gives the same answer on repeated calls", () => {
    const a = suggestGroup("Churrasco Típico (6 onz.)", dishes);
    const b = suggestGroup("Churrasco Típico (6 onz.)", dishes);
    expect(a?.target.id).toBe("1");
    expect(b).toEqual(a);
  });
  it("does not serve stale targets for a new array", () => {
    const grown: SuggestTarget[] = [
      ...dishes,
      {
        id: "g",
        name: "Limonadas",
        kind: "group",
        memberNames: ["Limonada Natural"],
      },
    ];
    expect(suggestGroup("Limonada con Fresa", dishes)).toBeNull();
    expect(suggestGroup("Limonada con Fresa", grown)?.target.id).toBe("g");
  });
});
