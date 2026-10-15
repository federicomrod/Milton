"use client";

// R1-15h: the Menú header (title, Preguntar a Milton, Sincronizar, tabs) and
// each screen's control panel (view toggle, search, suggestions, filters,
// selection bar) stay at the top while a long table scrolls. The header
// publishes its height as --menu-top; the panel sticks right under it and
// publishes where the table header must stick (--menu-table-top).

import { useEffect, useRef, type ReactNode } from "react";

function observeHeight(
  el: HTMLElement | null,
  publish: (height: number) => void
): () => void {
  if (!el) return () => {};
  const update = () => publish(Math.round(el.getBoundingClientRect().height));
  update();
  if (typeof ResizeObserver === "undefined") return () => {};
  const ro = new ResizeObserver(update);
  ro.observe(el);
  return () => ro.disconnect();
}

/** Sticks to the very top; everything below sticks under it. */
export function StickyMenuHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const stop = observeHeight(ref.current, (h) =>
      root.style.setProperty("--menu-top", `${h}px`)
    );
    return () => {
      stop();
      root.style.removeProperty("--menu-top");
    };
  }, []);
  return (
    <div
      ref={ref}
      className="sticky top-0 z-30 -mx-[26px] bg-background px-[26px] pt-4"
    >
      {children}
    </div>
  );
}

/** A screen's controls: under the header, above the table. */
export function StickyPanel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const stop = observeHeight(ref.current, (h) =>
      root.style.setProperty(
        "--menu-table-top",
        `calc(var(--menu-top, 0px) + ${h}px)`
      )
    );
    return () => {
      stop();
      root.style.removeProperty("--menu-table-top");
    };
  }, []);
  return (
    <div
      ref={ref}
      data-testid="sticky-panel"
      className={
        "sticky top-[var(--menu-top,0px)] z-20 -mx-1 space-y-3 bg-background px-1 pb-2 pt-1 " +
        className
      }
    >
      {children}
    </div>
  );
}

/** Class for a table header cell that sticks under the panel. */
export const STICKY_TH =
  "sticky top-[var(--menu-table-top,var(--menu-top,0px))] z-10 bg-[#f3f6fd]";
