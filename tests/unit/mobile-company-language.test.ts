// The Cocina app speaks the company's language (same setting as the web), not
// the phone's. The API tells it at join (redeem) and on every /me; anything
// unset or unknown is Spanish.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  assertNoMoneyFields,
  serializeKitchenMe,
  serializeKitchenRedeem,
} from "@/lib/restaurant/kitchen/kitchen-serializer";

const redeem = (language?: unknown) =>
  serializeKitchenRedeem({
    deviceToken: "t",
    staffId: "s",
    staffName: "Luis",
    locationId: "l",
    locationName: "Centro",
    language,
  });
const me = (company: Record<string, unknown> | null) =>
  serializeKitchenMe({
    staff: { id: "s", display_name: "Luis" },
    company,
    locations: [],
  });

describe("company language in the app API", () => {
  it.each([
    ["es", "es"],
    ["en", "en"],
    ["de", "de"],
    [null, "es"],
    [undefined, "es"],
    ["fr", "es"],
    [7, "es"],
  ])("redeem: %j -> %s", (stored, expected) => {
    expect(redeem(stored).language).toBe(expected);
  });

  it.each([
    ["en", "en"],
    ["de", "de"],
    [null, "es"],
    ["xx", "es"],
  ])("/me: %j -> %s", (stored, expected) => {
    expect(me({ name: "Casa A", preferred_language: stored }).company).toEqual({
      name: "Casa A",
      language: expected,
    });
    expect(me(null).company.language).toBe("es");
  });

  it("the language field does not trip the money guard", () => {
    expect(() => assertNoMoneyFields(redeem("de"))).not.toThrow();
    expect(() =>
      assertNoMoneyFields(me({ name: "Casa", preferred_language: "en" }))
    ).not.toThrow();
  });

  it("the routes read companies.preferred_language", () => {
    const meRoute = readFileSync(
      join(process.cwd(), "app/api/mobile/v1/kitchen/me/route.ts"),
      "utf8"
    );
    const redeemRoute = readFileSync(
      join(process.cwd(), "app/api/mobile/v1/kitchen/redeem/route.ts"),
      "utf8"
    );
    expect(meRoute).toContain('select("name, preferred_language")');
    expect(redeemRoute).toContain('select("preferred_language")');
  });
});
