"use client";

// «Lo que destaca» (max 3 facts, one compact card under the KPIs) and the
// collapsible «Análisis de ventas y tickets» line. Deterministic text from the
// cube (lib/restaurant/sales-detail-insights.ts): no AI call on load; the
// header's ask button is the only AI entry.

import type { SalesFact } from "@/lib/restaurant/sales-detail-insights";

export function Highlights({
  facts,
  read,
}: {
  facts: SalesFact[];
  read: string | null;
}) {
  if (facts.length === 0 && !read) return null;
  return (
    <section className="space-y-1.5" data-testid="sales-highlights">
      {facts.length > 0 ? (
        <div className="flex flex-wrap items-stretch gap-x-6 gap-y-1.5 rounded-[14px] border border-[#eef0f4] bg-white px-4 py-2.5">
          <h2 className="self-center text-[12px] font-bold text-[#1b40c8]">
            Lo que destaca
          </h2>
          {facts.map((f) => (
            <div
              key={f.id}
              className="min-w-0"
              data-testid={`sales-highlight-${f.id}`}
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8a92a3]">
                {f.title}
              </div>
              <div className="text-[13px] font-semibold text-[#151c2c]">
                {f.body}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {read ? (
        <details
          className="rounded-[14px] border border-[#eef0f4] bg-white px-4 py-2 text-[13px]"
          data-testid="sales-read"
        >
          <summary className="cursor-pointer text-[12.5px] font-semibold text-[#4a5a85]">
            Análisis de ventas y tickets
          </summary>
          <p className="mt-1 leading-snug text-[#151c2c]">{read}</p>
        </details>
      ) : null}
    </section>
  );
}
