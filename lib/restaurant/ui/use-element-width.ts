"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Real pixel width of an element, kept up to date with a ResizeObserver.
 * Returns `initial` (640) until the first measure, and stays there when
 * ResizeObserver does not exist (tests, old browsers).
 */
export function useElementWidth(
  ref: RefObject<Element | null>,
  initial = 640
): number {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
