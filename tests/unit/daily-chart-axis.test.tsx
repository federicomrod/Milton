// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { addDays } from "@/lib/restaurant/cockpit-math";

let mockWidth = 640;
vi.mock("@/lib/restaurant/ui/use-element-width", () => ({
  useElementWidth: () => mockWidth,
}));

import { DailyChart } from "@/components/restaurant/sales/detail/DailyChart";

const noop = () => {};
function draw(n: number, width: number) {
  mockWidth = width;
  const bars = Array.from({ length: n }, (_, i) => ({
    date: addDays("2026-09-26", i),
    net: 100 + i,
    tickets: 10,
    target: null,
  }));
  return render(
    createElement(DailyChart, {
      bars,
      metric: "ventas",
      money: (v: number) => `$${v}`,
      hasTarget: false,
      onMetric: noop,
      onDay: noop,
    })
  );
}

describe("DailyChart x axis", () => {
  it("30 days: last label present, «sáb 24 oct» dropped, drawn in real pixels", () => {
    const { container } = draw(30, 640);
    const texts = [...container.querySelectorAll("svg text")].map(
      (t) => t.textContent
    );
    expect(texts[texts.length - 1]).toBe("dom 25 oct");
    expect(texts).not.toContain("sáb 24 oct");
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 640 190"
    );
  });
  it("360px: viewBox follows the width and the first label is start-anchored", () => {
    const { container } = draw(30, 360);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 360 190"
    );
    const first = container.querySelector("svg text");
    expect(first?.getAttribute("text-anchor")).toBe("start");
    expect(first?.getAttribute("x")).toBe("0");
  });
});
