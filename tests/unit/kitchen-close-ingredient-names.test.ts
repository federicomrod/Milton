import { describe, expect, it } from "vitest";
import { closeIngredientNames } from "@/lib/restaurant/telegram/kitchen-media";

const catalog = (...names: string[]) =>
  names.map((name, i) => ({ id: `i${i}`, name }));

describe("closeIngredientNames", () => {
  it("never lists a name equal (normalized) to the said name", () => {
    for (const said of [
      "Harina de trigo",
      "harina de trigo",
      "HARINA  DE TRIGO",
      "harina de trigo",
    ]) {
      expect(
        closeIngredientNames(
          said,
          catalog("Harina de trigo", "Harina integral")
        )
      ).not.toContain("Harina de trigo");
    }
    expect(closeIngredientNames("azucar", catalog("Azúcar"))).toEqual([]);
  });
  it("still lists close but different names, and a plural/synonym", () => {
    expect(
      closeIngredientNames("aguacate", catalog("Aguacate Hass", "Tomate"))
    ).toEqual(["Aguacate Hass"]);
    expect(closeIngredientNames("tomates", catalog("Tomate"))).toEqual([
      "Tomate",
    ]);
  });
  it("at most 3, no duplicates", () => {
    const out = closeIngredientNames(
      "aguacate",
      catalog(
        "Aguacate Hass",
        "Aguacate criollo",
        "Aguacate verde",
        "Aguacate maduro"
      )
    );
    expect(out.length).toBeLessThanOrEqual(3);
    expect(new Set(out).size).toBe(out.length);
  });
});
