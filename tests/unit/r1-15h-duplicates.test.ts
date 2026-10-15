// R1-15h: «¿Parecen duplicados?» — same restaurant only, grouping only. Synthetic.
import { describe, expect, it } from "vitest";
import {
  duplicateHint,
  nearSameName,
} from "@/lib/restaurant/groups/duplicates";

const c = (ref: string, name: string, restaurant: string | null) => ({
  ref,
  name,
  restaurant,
});

describe("nearSameName", () => {
  it("same once accents, case and spaces are out", () => {
    expect(nearSameName("Baileys (Doble)", "baileys  (doble)")).toBe(true);
    expect(nearSameName("Tostón", "Toston")).toBe(true);
  });
  it("one or two letters apart on a longer name", () => {
    expect(nearSameName("Cerveza Pilsener", "Cerveza Pilsner")).toBe(true);
  });
  it("different products are not near-same", () => {
    expect(nearSameName("Baileys (Doble)", "Baileys (Sencillo)")).toBe(false);
    expect(nearSameName("Flan", "Fan")).toBe(false);
  });
});

describe("duplicateHint", () => {
  it("offers a group for same-name products of the SAME restaurant", () => {
    const h = duplicateHint([
      c("1", "Baileys (Doble)", "R1"),
      c("2", "Baileys (Doble)", "R1"),
      c("3", "Flan", "R1"),
    ]);
    expect(h?.refs.sort()).toEqual(["1", "2"]);
    expect(h?.name).toBe("Baileys (Doble)");
  });
  it("never across restaurants: the same name in R1 and R2 is two products", () => {
    expect(
      duplicateHint([
        c("1", "Baileys (Doble)", "R1"),
        c("2", "Baileys (Doble)", "R2"),
      ])
    ).toBeNull();
  });
  it("products sold in both or unknown restaurants are not matched", () => {
    expect(
      duplicateHint([
        c("1", "Baileys (Doble)", null),
        c("2", "Baileys (Doble)", null),
      ])
    ).toBeNull();
  });
  it("nothing to offer for a single product or unrelated names", () => {
    expect(duplicateHint([c("1", "Flan", "R1")])).toBeNull();
    expect(
      duplicateHint([c("1", "Flan", "R1"), c("2", "Sopa de casa", "R1")])
    ).toBeNull();
  });
  it("takes the biggest set", () => {
    const h = duplicateHint([
      c("1", "Mojito", "R1"),
      c("2", "Mojito", "R1"),
      c("3", "Cuba libre", "R1"),
      c("4", "Cuba libre", "R1"),
      c("5", "Cuba Libre", "R1"),
    ]);
    expect(h?.refs.sort()).toEqual(["3", "4", "5"]);
  });
});
