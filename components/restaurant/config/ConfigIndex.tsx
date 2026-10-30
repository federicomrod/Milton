"use client";

// components/restaurant/config/ConfigIndex.tsx
//
// Desktop: sticky left index. Mobile: sticky horizontal chip row. Click
// scrolls to the section; the section in view is highlighted. Also scrolls to
// the section named by the URL hash or the old ?tab= / ?seccion= links.

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import {
  CONFIG_SECTION_IDS,
  sectionForLegacyTab,
  type ConfigSectionId,
} from "@/lib/restaurant/config-sections";

export function ConfigIndex({ sections }: { sections: ConfigSectionId[] }) {
  const { d } = useT();
  const s = d.config.shared;
  const [current, setCurrent] = useState<ConfigSectionId>(
    sections[0] ?? CONFIG_SECTION_IDS[0]
  );

  const go = (id: ConfigSectionId, smooth = true) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "start",
    });
    setCurrent(id);
  };

  // Arriving with #cuenta or ?tab=cuenta: jump to that section.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted =
      sectionForLegacyTab(location.hash.replace(/^#/, "")) ??
      sectionForLegacyTab(params.get("tab")) ??
      sectionForLegacyTab(params.get("seccion"));
    if (wanted && sections.includes(wanted)) {
      requestAnimationFrame(() => go(wanted, false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The section whose top is nearest above the fold is the current one.
  useEffect(() => {
    const els = sections
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setCurrent(visible[0].target.id as ConfigSectionId);
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  const link = (id: ConfigSectionId, extra: string) => (
    <a
      key={id}
      href={`#${id}`}
      aria-current={current === id ? "location" : undefined}
      onClick={(e) => {
        e.preventDefault();
        history.replaceState(null, "", `#${id}`);
        go(id);
      }}
      className={
        extra +
        " text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] " +
        (current === id
          ? "bg-[#1B40C8] text-white"
          : "text-[#0F172A] hover:bg-[#EEF2FD]")
      }
    >
      {s.nav[id]}
    </a>
  );

  return (
    <>
      <nav
        aria-label={s.indexAria}
        data-testid="config-index"
        className="sticky top-24 hidden w-48 shrink-0 self-start lg:block"
      >
        <ul className="space-y-1">
          {sections.map((id) => (
            <li key={id}>{link(id, "block rounded-lg px-3 py-2")}</li>
          ))}
        </ul>
      </nav>
      <nav
        aria-label={s.indexAria}
        data-testid="config-chips"
        className="sticky top-0 z-20 -mx-[26px] overflow-x-auto border-b border-[#E5E7EB] bg-white px-[26px] py-2 lg:hidden"
      >
        <ul className="flex gap-2 whitespace-nowrap">
          {sections.map((id) => (
            <li key={id}>
              {link(
                id,
                "block rounded-full border border-[#E5E7EB] px-3 py-1.5"
              )}
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
