import { describe, expect, it } from "vitest";
import {
  ASK_MILTON_MAX_COUNT,
  listSize,
  parseRequestedCount,
} from "@/lib/restaurant/ask-milton-count";

describe("parseRequestedCount", () => {
  it.each([
    ["cuales son mis tres platos con peores margenes?", 3],
    ["mis 3 platos con peor margen", 3],
    ["top 3 platos", 3],
    ["top-5 ingredientes", 5],
    ["dame los dos peores", 2],
    ["los cinco productos más vendidos", 5],
    ["my three worst dishes", 3],
    ["top 10 dishes", 10],
    ["top one dish", 1],
    ["diez platos más vendidos", 10],
  ])("%s → %i", (q, n) => {
    expect(parseRequestedCount(q)).toBe(n);
  });

  it.each([
    "¿qué platos tienen peor margen?",
    "lo más vendido de los últimos 7 días",
    "una pregunta sobre platos",
    "ventas de julio 2026",
  ])("no count in «%s»", (q) => {
    expect(parseRequestedCount(q)).toBeNull();
  });

  it("clamps big asks", () => {
    expect(parseRequestedCount("top 50 platos")).toBe(ASK_MILTON_MAX_COUNT);
  });

  it("listSize keeps the default when nothing is asked", () => {
    expect(listSize("¿qué platos tienen peor margen?", 5)).toBe(5);
    expect(listSize("mis tres platos", 5)).toBe(3);
  });
});
